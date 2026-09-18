import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { createTestUserWithLedger, testBookId } from "../../helpers/schema-setup";
import {
  postgresLedgerProjectionAdapter,
  postgresRevisionAdapter,
} from "@/application/adapters/postgres";
import {
  entryCategories,
  ledgerEntries,
  revisionFiles,
  sourceDocumentRevisions,
  sourceDocuments,
  storedFiles,
} from "@/persistence";

const projectionEntry = {
  categoryId: null,
  amount: "12.50",
  currency: "CNY",
  itemName: "Lunch",
  description: null,
  convertedAmount: "12.50",
  exchangeRate: "1.000000",
} as const;

describe("current-runtime target adapters", () => {
  it("creates, paginates, authorizes, and preserves revision state", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const { ledgerId: otherLedgerId } = await createTestUserWithLedger(
      db,
      undefined,
      undefined,
      crypto.randomUUID()
    );

    const first = await postgresRevisionAdapter.createProcessingRevision({
      ledgerId,
      input: { text: "first", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });
    await expect(postgresRevisionAdapter.get(otherLedgerId, first.document.id)).resolves.toBeNull();
    await expect(
      postgresRevisionAdapter.createProcessingRevision({
        ledgerId,
        sourceDocumentId: first.document.id,
        input: { text: "duplicate", storedFileIds: [], documentDate: null },
        bookId: await testBookId(db, ledgerId),
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      postgresRevisionAdapter.markProcessing({
        ledgerId,
        sourceDocumentId: first.document.id,
        revisionId: first.revision.id,
      })
    ).resolves.toBe(true);
    await expect(
      postgresRevisionAdapter.recordProcessingFailure({
        ledgerId,
        sourceDocumentId: first.document.id,
        revisionId: first.revision.id,
        failureKind: "processing_error",
        failureMessage: "processing failed",
        failureCode: "PROCESSING_UNAVAILABLE",
      })
    ).resolves.toBe(true);

    const retry = await postgresRevisionAdapter.createProcessingRevision({
      ledgerId,
      sourceDocumentId: first.document.id,
      input: { text: "retry", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });
    await postgresRevisionAdapter.markProcessing({
      ledgerId,
      sourceDocumentId: first.document.id,
      revisionId: retry.revision.id,
    });
    await expect(
      postgresLedgerProjectionAdapter.activateRevision({
        ledgerId,
        expectedMainCurrency: "CNY",
        sourceDocumentId: first.document.id,
        revisionId: retry.revision.id,
        entries: [projectionEntry],
      })
    ).resolves.toBe(true);

    const failedRetry = await postgresRevisionAdapter.createProcessingRevision({
      ledgerId,
      sourceDocumentId: first.document.id,
      input: { text: "bad retry", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });
    await postgresRevisionAdapter.recordProcessingFailure({
      ledgerId,
      sourceDocumentId: first.document.id,
      revisionId: failedRetry.revision.id,
      failureKind: "invalid_input",
      failureMessage: "unreadable",
    });
    const preserved = await postgresRevisionAdapter.get(ledgerId, first.document.id);
    expect(preserved).toMatchObject({
      activeRevisionId: retry.revision.id,
      latestSubmissionRevisionId: failedRetry.revision.id,
    });

    const second = await postgresRevisionAdapter.createProcessingRevision({
      ledgerId,
      input: { text: "second", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });
    const page1 = await postgresRevisionAdapter.list({ ledgerId, limit: 1 });
    const page2 = await postgresRevisionAdapter.list({
      ledgerId,
      limit: 1,
      cursor: page1.nextCursor!,
    });
    expect([page1.items[0]?.id, page2.items[0]?.id].sort()).toEqual(
      [first.document.id, second.document.id].sort()
    );
  });

  it("rolls back activation when a projection violates ledger ownership", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const { ledgerId: otherLedgerId } = await createTestUserWithLedger(
      db,
      undefined,
      undefined,
      crypto.randomUUID()
    );
    const [otherCategory] = await db
      .insert(entryCategories)
      .values({ ledgerId: otherLedgerId, name: "Other" })
      .returning();
    const pending = await postgresRevisionAdapter.createProcessingRevision({
      ledgerId,
      input: { text: "receipt", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });

    await expect(
      postgresLedgerProjectionAdapter.activateRevision({
        ledgerId,
        expectedMainCurrency: "CNY",
        sourceDocumentId: pending.document.id,
        revisionId: pending.revision.id,
        entries: [{ ...projectionEntry, categoryId: otherCategory!.id }],
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const document = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, pending.document.id),
    });
    const revision = await db.query.sourceDocumentRevisions.findFirst({
      where: eq(sourceDocumentRevisions.id, pending.revision.id),
    });
    expect(document).toMatchObject({
      activeRevisionId: null,
      latestSubmissionRevisionId: pending.revision.id,
    });
    expect(revision?.processingStatus).toBe("processing");
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it("never creates target projections for an already-deleted legacy bill", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const [legacy] = await db
      .insert(sourceDocuments)
      .values({
        ledgerId,
        deletedAt: new Date(),
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      })
      .returning();

    await expect(
      postgresRevisionAdapter.createProcessingRevision({
        ledgerId,
        sourceDocumentId: legacy!.id,
        input: { text: "receipt", storedFileIds: [], documentDate: null },
        bookId: await testBookId(db, ledgerId),
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.select().from(sourceDocumentRevisions)).toHaveLength(0);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it("soft deletes active and pending documents without removing evidence or accepting late completion", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const active = await postgresLedgerProjectionAdapter.createManual({
      expectedMainCurrency: "CNY",
      ledgerId,
      entries: [projectionEntry],
      bookId: await testBookId(db, ledgerId),
    });
    const [file] = await db
      .insert(storedFiles)
      .values({
        ledgerId,
        storageProvider: "local",
        storageKey: `${ledgerId}/stored/pending-evidence`,
        contentType: "image/jpeg",
        byteSize: 7,
        finalizedAt: new Date(),
      })
      .returning();
    const pending = await postgresRevisionAdapter.createProcessingRevision({
      ledgerId,
      sourceDocumentId: active.sourceDocumentId,
      input: { text: null, storedFileIds: [file!.id], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });
    expect(pending.document.supportedActions).toEqual([
      "cancel_processing",
      "retry",
      "edit_retry",
      "delete",
    ]);
    const revisionCount = (await db.select().from(sourceDocumentRevisions)).length;
    const fileLinkCount = (await db.select().from(revisionFiles)).length;

    await expect(
      postgresRevisionAdapter.softDelete(ledgerId, active.sourceDocumentId)
    ).resolves.toBe(true);
    await expect(
      postgresRevisionAdapter.softDelete(ledgerId, active.sourceDocumentId)
    ).resolves.toBe(false);
    await expect(
      postgresLedgerProjectionAdapter.activateRevision({
        ledgerId,
        expectedMainCurrency: "CNY",
        sourceDocumentId: active.sourceDocumentId,
        revisionId: pending.revision.id,
        entries: [{ ...projectionEntry, amount: "99.00" }],
      })
    ).resolves.toBe(false);
    await expect(
      postgresRevisionAdapter.markProcessing({
        ledgerId,
        sourceDocumentId: active.sourceDocumentId,
        revisionId: pending.revision.id,
      })
    ).resolves.toBe(false);

    const deleted = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, active.sourceDocumentId),
    });
    expect(deleted).toMatchObject({
      deletedAt: expect.any(Date),
      activeRevisionId: active.revisionId,
      latestSubmissionRevisionId: pending.revision.id,
    });
    expect(await db.select().from(sourceDocumentRevisions)).toHaveLength(revisionCount);
    expect(await db.select().from(revisionFiles)).toHaveLength(fileLinkCount);
    expect(await db.select().from(storedFiles)).toHaveLength(1);
    expect(
      await db.query.ledgerEntries.findFirst({
        where: eq(ledgerEntries.sourceDocumentId, active.sourceDocumentId),
      })
    ).toMatchObject({ deletedAt: expect.any(Date) });
  });
});
