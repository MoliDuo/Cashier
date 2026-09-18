import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createStoredFileAdapter, type StoredFileAdapter } from "@/application/adapters/storage";
import {
  PostgresProcessingJobAdapter,
  postgresLedgerProjectionAdapter,
  postgresRevisionAdapter,
  postgresSourceDocumentSubmissionAdapter,
  getTargetSourceDocument,
} from "@/application/adapters/postgres";
import {
  ledgerEntries,
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
import { createTestUserWithLedger, testBookId } from "../../helpers/schema-setup";
import { getTestDb } from "../../setup";

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
