import { eq } from "drizzle-orm";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { createStoredFileAdapter, type StoredFileAdapter } from "@/application/adapters/storage";
import {
  PostgresProcessingJobAdapter,
  postgresBookAdapter,
  postgresLedgerProjectionAdapter,
  postgresRevisionAdapter,
  postgresSourceDocumentSubmissionAdapter,
  getTargetSourceDocument,
} from "@/application/adapters/postgres";
import {
  ledgerEntries,
  ledgers,
  idempotencyRecords,
  processingAttempts,
  processingOutbox,
  revisionFiles,
  serviceCredentials,
  sourceDocumentRevisions,
  sourceDocuments,
  storedFiles,
} from "@/persistence";
import { ValidationError } from "@/lib/errors";
import { MAX_FILES } from "@/lib/storage/upload-policy";
import { createTestBooks, createTestUserWithLedger, testBookId } from "../../helpers/schema-setup";
import { getTestDb, getTestSchemaName } from "../../setup";

class MemoryFileStore {
  readonly files = new Map<string, Buffer>();

  async upload(key: string, data: Buffer): Promise<string> {
    this.files.set(key, Buffer.from(data));
    return `/private/${key}`;
  }

  async download(key: string): Promise<Buffer> {
    return Buffer.from(this.files.get(key) ?? []);
  }

  async delete(key: string): Promise<{ success: boolean }> {
    return { success: this.files.delete(key) };
  }
}

async function finalizedFile(adapter: StoredFileAdapter, ledgerId: string, body: Buffer) {
  const plan = await adapter.createUploadPlan(ledgerId, [
    { contentType: "image/jpeg", byteSize: body.length, originalFilename: "receipt.jpg" },
  ]);
  await adapter.uploadTarget({
    ledgerId,
    uploadSessionId: plan.id,
    targetId: plan.targets[0]!.id,
    contentType: "image/jpeg",
    body,
  });
  const [file] = await adapter.finalizeUpload({
    ownerLedgerId: ledgerId,
    uploadSessionId: plan.id,
    finalizationToken: plan.finalizationToken,
    targetIds: [plan.targets[0]!.id],
  });
  return file!;
}

const entry = {
  categoryId: null,
  amount: "12.50",
  currency: "CNY",
  itemName: "Lunch",
  description: null,
  convertedAmount: "12.50",
  exchangeRate: "1.000000",
} as const;

describe("target source-document submissions", () => {
  it("creates one document, revision, and job for concurrent user submissions", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const bookId = await testBookId(db, ledgerId);
    const prepare = vi.fn(async () => ({
      ledgerId,
      bookId,
      input: { text: "Lunch 12.50", storedFileIds: [], documentDate: null },
    }));
    const idempotency = {
      principalType: "user" as const,
      principalId: crypto.randomUUID(),
      key: `create:${crypto.randomUUID()}`,
      contentFingerprint: null,
    };

    const [first, replay] = await Promise.all([
      postgresSourceDocumentSubmissionAdapter.submitIdempotently!(idempotency, prepare),
      postgresSourceDocumentSubmissionAdapter.submitIdempotently!(idempotency, prepare),
    ]);

    expect(first.document.id).toBe(replay.document.id);
    expect(prepare).toHaveBeenCalledOnce();
    expect(await db.select().from(sourceDocuments)).toHaveLength(1);
    expect(await db.select().from(sourceDocumentRevisions)).toHaveLength(1);
    expect(await db.select().from(processingOutbox)).toHaveLength(1);
  });

  it("rolls back a fencing loser after an expired idempotency lease is taken over", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const bookId = await testBookId(db, ledgerId);
    const credentialId = crypto.randomUUID();
    await db.insert(serviceCredentials).values({
      id: credentialId,
      ledgerId,
      name: "fencing-test",
      tokenHash: "f".repeat(64),
      tokenPrefix: "cashier_test",
      tokenSuffix: "test",
      bookId,
    });
    const idempotency = {
      principalType: "credential" as const,
      principalId: credentialId,
      key: "fencing-takeover",
      contentFingerprint: "same-content",
    };
    let signalStarted!: () => void;
    let releaseFirst!: () => void;
    const started = new Promise<void>((resolve) => (signalStarted = resolve));
    const gate = new Promise<void>((resolve) => (releaseFirst = resolve));

    const first = postgresSourceDocumentSubmissionAdapter.submitIdempotently!(
      idempotency,
      async () => {
        signalStarted();
        await gate;
        return {
          ledgerId,
          bookId,
          input: { text: "receipt", storedFileIds: [], documentDate: null },
        };
      }
    );
    await started;
    await db
      .update(idempotencyRecords)
      .set({ leaseExpiresAt: new Date(Date.now() - 1) })
      .where(eq(idempotencyRecords.key, idempotency.key));

    const winner = await postgresSourceDocumentSubmissionAdapter.submitIdempotently!(
      idempotency,
      async () => ({
        ledgerId,
        bookId,
        input: { text: "receipt", storedFileIds: [], documentDate: null },
      })
    );
    releaseFirst();
    await expect(first).rejects.toThrow("idempotency lease expired");

    expect(await db.select().from(sourceDocuments)).toHaveLength(1);
    expect(await db.select().from(sourceDocumentRevisions)).toHaveLength(1);
    expect(await db.select().from(processingOutbox)).toHaveLength(1);
    expect(winner.document.id).toBe((await db.select().from(sourceDocuments))[0]?.id);
  });

  it("atomically creates text, image, and mixed pending revisions with durable intents", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const storage = createStoredFileAdapter({ storage: new MemoryFileStore() });
    const image = await finalizedFile(storage, ledgerId, Buffer.from("image"));

    const text = await postgresSourceDocumentSubmissionAdapter.submit({
      ledgerId,
      input: { text: "Lunch 12.50", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });
    const imageOnly = await postgresSourceDocumentSubmissionAdapter.submit({
      ledgerId,
      input: { text: null, storedFileIds: [image.id], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });
    const mixed = await postgresSourceDocumentSubmissionAdapter.submit({
      ledgerId,
      input: { text: "Mixed", storedFileIds: [image.id], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });

    expect(new Set([text.document.id, imageOnly.document.id, mixed.document.id]).size).toBe(3);
    expect(await db.select().from(sourceDocumentRevisions)).toHaveLength(3);
    expect(await db.select().from(processingOutbox)).toHaveLength(3);
    expect(await db.select().from(processingAttempts)).toHaveLength(3);
    expect(await db.select().from(revisionFiles)).toHaveLength(2);
    expect(mixed.job).toMatchObject({
      sourceDocumentId: mixed.document.id,
      revisionId: mixed.revision.id,
    });
  });

  it("rolls back the document, revision, and job when evidence is not finalized", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const [unfinalized] = await db
      .insert(storedFiles)
      .values({
        ledgerId,
        storageProvider: "local",
        storageKey: `${ledgerId}/unfinalized`,
        contentType: "image/jpeg",
        byteSize: 1,
      })
      .returning();

    await expect(
      postgresSourceDocumentSubmissionAdapter.submit({
        ledgerId,
        input: { text: null, storedFileIds: [unfinalized!.id], documentDate: null },
        bookId: await testBookId(db, ledgerId),
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.select().from(sourceDocuments)).toHaveLength(0);
    expect(await db.select().from(sourceDocumentRevisions)).toHaveLength(0);
    expect(await db.select().from(processingOutbox)).toHaveLength(0);
  });

  it.each([
    ["processing_error", "PROCESSING_UNAVAILABLE"],
    ["invalid_input", null],
  ] as const)(
    "keeps a first %s failure without an active revision or ledger projection",
    async (failureKind, failureCode) => {
      const db = getTestDb();
      const { ledgerId } = await createTestUserWithLedger(db);
      const pending = await postgresSourceDocumentSubmissionAdapter.submit({
        ledgerId,
        input: { text: "first parse evidence", storedFileIds: [], documentDate: null },
        bookId: await testBookId(db, ledgerId),
      });

      await expect(
        postgresRevisionAdapter.recordProcessingFailure({
          ledgerId,
          sourceDocumentId: pending.document.id,
          revisionId: pending.revision.id,
          failureKind,
          failureMessage: failureKind === "invalid_input" ? "unreadable" : "processing failed",
          ...(failureCode == null ? {} : { failureCode }),
        })
      ).resolves.toBe(true);

      const document = await postgresRevisionAdapter.get(ledgerId, pending.document.id);
      expect(document).toMatchObject({
        activeRevisionId: null,
        latestSubmissionRevisionId: pending.revision.id,
        supportedActions: ["retry", "edit_retry", "delete"],
      });
      expect(await db.select().from(ledgerEntries)).toHaveLength(0);
    }
  );

  it("preserves active results across failed/anomalous retries and rejects stale activation", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const active = await postgresLedgerProjectionAdapter.createManual({
      expectedMainCurrency: "CNY",
      ledgerId,
      entries: [entry],
      bookId: await testBookId(db, ledgerId),
    });
    const activeEntry = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.sourceDocumentRevisionId, active.revisionId),
    });

    const failed = await postgresSourceDocumentSubmissionAdapter.submit({
      ledgerId,
      sourceDocumentId: active.sourceDocumentId,
      input: { text: "failed retry", storedFileIds: [], documentDate: null },
      inheritInput: false,
      bookId: await testBookId(db, ledgerId),
    });
    await postgresRevisionAdapter.recordProcessingFailure({
      ledgerId,
      sourceDocumentId: active.sourceDocumentId,
      revisionId: failed.revision.id,
      failureKind: "processing_error",
      failureMessage: "processing failed",
    });
    const anomalous = await postgresSourceDocumentSubmissionAdapter.submit({
      ledgerId,
      sourceDocumentId: active.sourceDocumentId,
      input: { text: "anomalous edit retry", storedFileIds: [], documentDate: null },
      inheritInput: false,
      bookId: await testBookId(db, ledgerId),
    });
    await postgresRevisionAdapter.recordProcessingFailure({
      ledgerId,
      sourceDocumentId: active.sourceDocumentId,
      revisionId: anomalous.revision.id,
      failureKind: "invalid_input",
      failureMessage: "unreadable",
    });

    expect(
      await postgresLedgerProjectionAdapter.activateRevision({
        ledgerId,
        expectedMainCurrency: "CNY",
        sourceDocumentId: active.sourceDocumentId,
        revisionId: failed.revision.id,
        entries: [{ ...entry, amount: "99.00" }],
      })
    ).toBe(false);
    expect(
      await postgresRevisionAdapter.recordProcessingFailure({
        ledgerId,
        sourceDocumentId: active.sourceDocumentId,
        revisionId: failed.revision.id,
        failureKind: "processing_error",
        failureMessage: "processing failed",
      })
    ).toBe(false);
    const document = await postgresRevisionAdapter.get(ledgerId, active.sourceDocumentId);
    expect(document).toMatchObject({
      activeRevisionId: active.revisionId,
      latestSubmissionRevisionId: anomalous.revision.id,
    });
    expect(
      await db.query.ledgerEntries.findFirst({ where: eq(ledgerEntries.id, activeEntry!.id) })
    ).toMatchObject({ amount: "12.500", deletedAt: null });
  });

  it("inherits immutable evidence on retry and deduplicates post-commit dispatch", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const storage = createStoredFileAdapter({ storage: new MemoryFileStore() });
    const image = await finalizedFile(storage, ledgerId, Buffer.from("image"));
    const initial = await postgresSourceDocumentSubmissionAdapter.submit({
      ledgerId,
      input: { text: "original", storedFileIds: [image.id], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });
    await postgresRevisionAdapter.recordProcessingFailure({
      ledgerId,
      sourceDocumentId: initial.document.id,
      revisionId: initial.revision.id,
      failureKind: "processing_error",
      failureMessage: "processing failed",
    });
    const retry = await postgresSourceDocumentSubmissionAdapter.submit({
      ledgerId,
      sourceDocumentId: initial.document.id,
      inheritInput: true,
      bookId: await testBookId(db, ledgerId),
    });

    await Promise.all([
      new PostgresProcessingJobAdapter().dispatch(retry.job),
      new PostgresProcessingJobAdapter().dispatch(retry.job),
    ]);
    const retryRevision = await db.query.sourceDocumentRevisions.findFirst({
      where: eq(sourceDocumentRevisions.id, retry.revision.id),
    });
    const retryFiles = await db.query.revisionFiles.findMany({
      where: eq(revisionFiles.revisionId, retry.revision.id),
    });
    expect(retry.document.id).toBe(initial.document.id);
    expect(retryRevision?.inputText).toBe("original");
    expect(retryFiles.map((file) => file.storedFileId)).toEqual([image.id]);
    expect(await db.select().from(processingOutbox)).toHaveLength(2);
    expect(await db.select().from(processingAttempts)).toHaveLength(2);
  });

  it("rejects inherited evidence retry when previous revision exceeds MAX_FILES", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const storage = createStoredFileAdapter({ storage: new MemoryFileStore() });

    // Create MAX_FILES + 1 finalized stored files
    const body = Buffer.from("tiny");
    const files = await Promise.all(
      Array.from({ length: MAX_FILES + 1 }, () => finalizedFile(storage, ledgerId, body))
    );

    // Create a revision with MAX_FILES files via the normal path (this succeeds)
    const initial = await postgresSourceDocumentSubmissionAdapter.submit({
      ledgerId,
      input: {
        text: "initial",
        storedFileIds: files.slice(0, MAX_FILES).map((f) => f.id),
        documentDate: null,
      },
      bookId: await testBookId(db, ledgerId),
    });
    await postgresRevisionAdapter.recordProcessingFailure({
      ledgerId,
      sourceDocumentId: initial.document.id,
      revisionId: initial.revision.id,
      failureKind: "processing_error",
      failureMessage: "processing failed",
    });

    // Directly insert an extra revisionFile record to simulate a pre-existing
    // overflow that predates the aggregate file-count check.
    const overflowFileId = files[MAX_FILES]!.id;
    await db.insert(revisionFiles).values({
      ledgerId,
      revisionId: initial.revision.id,
      storedFileId: overflowFileId,
      position: MAX_FILES,
    });

    // Inherited evidence retry should now reject because createProcessingRevisionInTransaction
    // enforces the MAX_FILES limit.
    await expect(
      postgresSourceDocumentSubmissionAdapter.submit({
        ledgerId,
        sourceDocumentId: initial.document.id,
        inheritInput: true,
        bookId: await testBookId(db, ledgerId),
      })
    ).rejects.toThrow(ValidationError);
  });

  it("returns ordered stored-file identities and rejects cross-workspace retry evidence", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const { ledgerId: otherLedgerId } = await createTestUserWithLedger(
      db,
      undefined,
      undefined,
      crypto.randomUUID()
    );
    const storage = createStoredFileAdapter({ storage: new MemoryFileStore() });
    const first = await finalizedFile(storage, ledgerId, Buffer.from("first"));
    const second = await finalizedFile(storage, ledgerId, Buffer.from("second"));
    const other = await finalizedFile(storage, otherLedgerId, Buffer.from("other"));
    const submitted = await postgresSourceDocumentSubmissionAdapter.submit({
      ledgerId,
      input: { text: null, storedFileIds: [second.id, first.id], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });

    const detail = await getTargetSourceDocument(ledgerId, submitted.document.id);
    expect(detail?.files.map((file) => file.id)).toEqual([second.id, first.id]);
    expect(detail).not.toHaveProperty("imageUrls");
    expect(JSON.stringify(detail)).not.toContain("/api/uploads/");
    expect(JSON.stringify(detail)).not.toContain("storageKey");
    await postgresRevisionAdapter.recordProcessingFailure({
      ledgerId,
      sourceDocumentId: submitted.document.id,
      revisionId: submitted.revision.id,
      failureKind: "processing_error",
      failureMessage: "processing failed",
    });
    await expect(
      postgresSourceDocumentSubmissionAdapter.submit({
        ledgerId,
        sourceDocumentId: submitted.document.id,
        input: { text: null, storedFileIds: [other.id], documentDate: null },
        bookId: await testBookId(db, ledgerId),
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      postgresSourceDocumentSubmissionAdapter.submit({
        ledgerId: otherLedgerId,
        sourceDocumentId: submitted.document.id,
        inheritInput: true,
        bookId: await testBookId(db, ledgerId),
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

/**
 * A pool of its own, so a case can hold a transaction open without starving the
 * pool the shared `db` uses for the code under test.
 */
function racePool(): Pool {
  const schema = getTestSchemaName();
  if (!/^[a-zA-Z0-9_]+$/.test(schema)) throw new Error("Unexpected test schema name");
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema},public`,
    max: 4,
  });
}

/**
 * Takes the ledger row lock the archive and delete paths take, and returns the
 * transaction id other sessions will block on. The id is read from `pg_locks`
 * rather than `pg_current_xact_id()` because only the former is the same 32-bit
 * value a waiter's lock entry names.
 */
async function lockLedgerRow(client: PoolClient, ledgerId: string): Promise<string> {
  await client.query("BEGIN");
  await client.query("SELECT id FROM ledgers WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [
    ledgerId,
  ]);
  const held = await client.query<{ xid: string }>(
    `SELECT transactionid::text AS xid
       FROM pg_locks
      WHERE pid = pg_backend_pid() AND locktype = 'transactionid' AND granted`
  );
  const xid = held.rows[0]?.xid;
  if (xid == null) throw new Error("The blocking transaction holds no row lock");
  return xid;
}

/**
 * Waits until another session is genuinely waiting on the lock `holderXid`
 * holds. Polling the exact blocking transaction — rather than sleeping a fixed
 * time — is what makes the race cases deterministic.
 */
async function waitUntilBlockedOn(pool: Pool, holderXid: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query<{ waiting: number }>(
      `SELECT count(*)::int AS waiting
         FROM pg_locks
        WHERE NOT granted AND locktype = 'transactionid' AND transactionid::text = $1`,
      [holderXid]
    );
    if (Number(rows[0]?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for the competing transaction to block on the ledger lock");
}

async function expectNoRecordRows(db: ReturnType<typeof getTestDb>): Promise<void> {
  expect(await db.select().from(sourceDocuments)).toHaveLength(0);
  expect(await db.select().from(sourceDocumentRevisions)).toHaveLength(0);
  expect(await db.select().from(processingOutbox)).toHaveLength(0);
}

/**
 * The new-record path resolves its book before the write transaction opens, so
 * only the lock the insert takes can make that choice final. These cases drive
 * the real ports across two connections.
 */
describe("new-record submission against a concurrent archive or ledger delete", () => {
  it("refuses a new record for a book archived before the insert", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const travel = (await createTestBooks(db, ledgerId, ["旅行支出"])).get("旅行支出")!;
    expect(await postgresBookAdapter.archive(ledgerId, travel)).toMatchObject({
      status: "archived",
    });

    await expect(
      postgresSourceDocumentSubmissionAdapter.submit({
        ledgerId,
        bookId: travel,
        input: { text: "late", storedFileIds: [], documentDate: null },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Book not found" });
    await expectNoRecordRows(db);
  });

  it("refuses a new record for a ledger deleted before the insert", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const bookId = await testBookId(db, ledgerId);
    await db.update(ledgers).set({ deletedAt: new Date() }).where(eq(ledgers.id, ledgerId));

    await expect(
      postgresSourceDocumentSubmissionAdapter.submit({
        ledgerId,
        bookId,
        input: { text: "late", storedFileIds: [], documentDate: null },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Ledger not found" });
    await expectNoRecordRows(db);
  });

  it("refuses a book that belongs to another ledger", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const other = await createTestUserWithLedger(
      db,
      "other@example.com",
      undefined,
      crypto.randomUUID()
    );
    const foreignBookId = await testBookId(db, ledgerId);

    await expect(
      postgresSourceDocumentSubmissionAdapter.submit({
        ledgerId: other.ledgerId,
        bookId: foreignBookId,
        input: { text: "cross-ledger", storedFileIds: [], documentDate: null },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Book not found" });
    expect(await db.select().from(sourceDocuments)).toHaveLength(0);
  });

  it("refuses the insert an archive that already holds the ledger lock", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const travel = (await createTestBooks(db, ledgerId, ["旅行支出"])).get("旅行支出")!;
    const pool = racePool();
    const blocker = await pool.connect();
    try {
      const holderXid = await lockLedgerRow(blocker, ledgerId);
      await blocker.query(
        "UPDATE books SET archived_at = now(), updated_at = now() WHERE ledger_id = $1 AND id = $2",
        [ledgerId, travel]
      );
      const insert = postgresSourceDocumentSubmissionAdapter
        .submit({
          ledgerId,
          bookId: travel,
          input: { text: "late", storedFileIds: [], documentDate: null },
        })
        .then(
          () => null,
          (error: unknown) => error
        );
      await waitUntilBlockedOn(pool, holderXid);
      await blocker.query("COMMIT");
      expect(await insert).toMatchObject({ code: "NOT_FOUND", message: "Book not found" });
    } finally {
      blocker.release();
      await pool.end();
    }
    await expectNoRecordRows(db);
  });

  it("refuses the insert a ledger delete that already holds the lock", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const bookId = await testBookId(db, ledgerId);
    const pool = racePool();
    const blocker = await pool.connect();
    try {
      const holderXid = await lockLedgerRow(blocker, ledgerId);
      await blocker.query("UPDATE ledgers SET deleted_at = now() WHERE id = $1", [ledgerId]);
      const insert = postgresSourceDocumentSubmissionAdapter
        .submit({
          ledgerId,
          bookId,
          input: { text: "late", storedFileIds: [], documentDate: null },
        })
        .then(
          () => null,
          (error: unknown) => error
        );
      await waitUntilBlockedOn(pool, holderXid);
      await blocker.query("COMMIT");
      expect(await insert).toMatchObject({ code: "NOT_FOUND", message: "Ledger not found" });
    } finally {
      blocker.release();
      await pool.end();
    }
    await expectNoRecordRows(db);
  });

  it("makes an archive wait for the insert and still retries the existing record", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const travel = (await createTestBooks(db, ledgerId, ["旅行支出"])).get("旅行支出")!;
    const pool = racePool();
    const holder = await pool.connect();
    const documentId = crypto.randomUUID();
    try {
      // The lock sequence a new submission takes, held open on purpose so the
      // archive is the transaction that has to wait.
      const holderXid = await lockLedgerRow(holder, ledgerId);
      await holder.query(
        "SELECT id FROM books WHERE ledger_id = $1 AND id = $2 AND archived_at IS NULL FOR SHARE",
        [ledgerId, travel]
      );
      await holder.query(
        "INSERT INTO source_documents (id, ledger_id, book_id, created_at, updated_at)" +
          " VALUES ($1, $2, $3, now(), now())",
        [documentId, ledgerId, travel]
      );

      const archive = postgresBookAdapter.archive(ledgerId, travel).then(
        (result) => result,
        (error: unknown) => error
      );
      await waitUntilBlockedOn(pool, holderXid);
      await holder.query("COMMIT");
      expect(await archive).toMatchObject({ status: "archived" });
    } finally {
      holder.release();
      await pool.end();
    }

    const retry = await postgresSourceDocumentSubmissionAdapter.submit({
      ledgerId,
      sourceDocumentId: documentId,
      input: { text: "retry", storedFileIds: [], documentDate: null },
    });
    expect(retry.document.id).toBe(documentId);
    expect(await db.select().from(sourceDocuments)).toHaveLength(1);
    expect(await db.select().from(sourceDocumentRevisions)).toHaveLength(1);
    expect(await db.select().from(processingOutbox)).toHaveLength(1);
  });

  it("replays a completed idempotent submission without a second document", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const bookId = await testBookId(db, ledgerId);
    const idempotency = {
      principalType: "user" as const,
      principalId: crypto.randomUUID(),
      key: `create:${crypto.randomUUID()}`,
      contentFingerprint: null,
    };
    const prepare = async () => ({
      ledgerId,
      bookId,
      input: { text: "Lunch 12.50", storedFileIds: [], documentDate: null },
    });

    const created = await postgresSourceDocumentSubmissionAdapter.submitIdempotently!(
      idempotency,
      prepare
    );
    const replay = await postgresSourceDocumentSubmissionAdapter.submitIdempotently!(
      idempotency,
      prepare
    );

    expect(replay.document.id).toBe(created.document.id);
    expect(replay.idempotencyReplay).toBe(true);
    expect(await db.select().from(sourceDocuments)).toHaveLength(1);
    expect(await db.select().from(sourceDocumentRevisions)).toHaveLength(1);
    expect(await db.select().from(processingOutbox)).toHaveLength(1);
  });
});
