import { claimRevisionForTest } from "tests/helpers/processing-revision";
import {
  getTargetSourceDocument,
  listTargetSourceDocuments,
} from "@/modules/source-document/server/reads/list";
import { createPendingRevision } from "tests/helpers/processing-revision";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { createTestUserWithLedger, testBookId } from "../../helpers/schema-setup";
import {
  entryCategories,
  ledgerEntries,
  sourceDocumentFiles,
  sourceDocumentRevisions,
  sourceDocuments,
  storedFiles,
} from "@/persistence";
import {
  activateRevision,
  createManualDocument,
} from "@/modules/source-document/server/projections/writes";
import { deleteSourceDocumentAtomically } from "@/modules/source-document/server/delete";
import { recordProcessingFailure } from "@/modules/source-document/server/revisions";

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

    const first = await createPendingRevision({
      ledgerId,
      input: { text: "first", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });
    await expect(getTargetSourceDocument(otherLedgerId, first.document.id)).resolves.toBeNull();
    await expect(
      createPendingRevision({
        ledgerId,
        sourceDocumentId: first.document.id,
        input: { text: "duplicate", storedFileIds: [], documentDate: null },
        bookId: await testBookId(db, ledgerId),
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      recordProcessingFailure({
        lease: await claimRevisionForTest(first.revision.id),
        ledgerId,
        sourceDocumentId: first.document.id,
        revisionId: first.revision.id,
        failureKind: "processing_error",
        failureMessage: "processing failed",
        failureCode: "PROCESSING_UNAVAILABLE",
      })
    ).resolves.toBe(true);

    const retry = await createPendingRevision({
      ledgerId,
      sourceDocumentId: first.document.id,
      input: { text: "retry", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });
    await expect(
      activateRevision({
        lease: await claimRevisionForTest(retry.revision.id),
        ledgerId,
        sourceDocumentId: first.document.id,
        revisionId: retry.revision.id,
        entries: [projectionEntry],
      })
    ).resolves.toBe(true);

    const failedRetry = await createPendingRevision({
      ledgerId,
      sourceDocumentId: first.document.id,
      input: { text: "bad retry", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });
    await recordProcessingFailure({
      lease: await claimRevisionForTest(failedRetry.revision.id),
      ledgerId,
      sourceDocumentId: first.document.id,
      revisionId: failedRetry.revision.id,
      failureKind: "invalid_input",
      failureMessage: "unreadable",
    });
    const preserved = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, first.document.id),
    });
    expect(preserved).toMatchObject({ latestSubmissionRevisionId: failedRetry.revision.id });
    // The failed retry leaves the entries of the completed one in place.
    expect(
      await db.query.ledgerEntries.findMany({
        where: eq(ledgerEntries.sourceDocumentId, first.document.id),
      })
    ).toEqual([expect.objectContaining({ amount: "12.500", deletedAt: null })]);

    const second = await createPendingRevision({
      ledgerId,
      input: { text: "second", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });
    const page1 = await listTargetSourceDocuments({ ledgerId, limit: 1 });
    const page2 = await listTargetSourceDocuments({
      ledgerId,
      limit: 1,
      cursor: page1.nextCursor!,
    });
    expect([page1.items[0]?.id, page2.items[0]?.id].sort()).toEqual(
      [first.document.id, second.document.id].sort()
    );
  });

  it("replaces a reparsed document's entries without leaving the old rows behind", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const bookId = await testBookId(db, ledgerId);
    const first = await createPendingRevision({
      ledgerId,
      input: { text: "first", storedFileIds: [], documentDate: null },
      bookId,
    });
    await activateRevision({
      lease: await claimRevisionForTest(first.revision.id),
      ledgerId,
      sourceDocumentId: first.document.id,
      revisionId: first.revision.id,
      entries: [projectionEntry, projectionEntry],
    });
    const reparse = await createPendingRevision({
      ledgerId,
      sourceDocumentId: first.document.id,
      input: { text: "reparse", storedFileIds: [], documentDate: null },
      bookId,
    });
    await activateRevision({
      lease: await claimRevisionForTest(reparse.revision.id),
      ledgerId,
      sourceDocumentId: first.document.id,
      revisionId: reparse.revision.id,
      entries: [{ ...projectionEntry, amount: "20.00" }],
    });

    expect(
      await db.query.ledgerEntries.findMany({
        where: eq(ledgerEntries.sourceDocumentId, first.document.id),
      })
    ).toEqual([expect.objectContaining({ amount: "20.000" })]);
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
    const pending = await createPendingRevision({
      ledgerId,
      input: { text: "receipt", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });

    await expect(
      activateRevision({
        lease: await claimRevisionForTest(pending.revision.id),
        ledgerId,
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
    expect(document).toMatchObject({ latestSubmissionRevisionId: pending.revision.id });
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
      createPendingRevision({
        ledgerId,
        sourceDocumentId: legacy!.id,
        input: { text: "receipt", storedFileIds: [], documentDate: null },
        bookId: await testBookId(db, ledgerId),
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.select().from(sourceDocumentRevisions)).toHaveLength(0);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it("deletes a document with everything it owns but its stored files, and refuses late completion", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const active = await createManualDocument({
      ledgerId,
      entries: [projectionEntry],
      bookId: await testBookId(db, ledgerId),
    });
    const [file] = await db
      .insert(storedFiles)
      .values({
        ledgerId,
        storageKey: `${ledgerId}/stored/pending-evidence`,
        contentType: "image/jpeg",
        byteSize: 7,
        finalizedAt: new Date(),
      })
      .returning();
    const pending = await createPendingRevision({
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
    const pendingLease = await claimRevisionForTest(pending.revision.id);
    expect(await db.select().from(sourceDocumentFiles)).toHaveLength(1);

    await expect(
      deleteSourceDocumentAtomically({
        ledgerId,
        sourceDocumentId: active.sourceDocumentId,
      })
    ).resolves.toMatchObject({ deleted: true });
    await expect(
      deleteSourceDocumentAtomically({
        ledgerId,
        sourceDocumentId: active.sourceDocumentId,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      activateRevision({
        lease: pendingLease,
        ledgerId,
        sourceDocumentId: active.sourceDocumentId,
        revisionId: pending.revision.id,
        entries: [{ ...projectionEntry, amount: "99.00" }],
      })
    ).resolves.toBe(false);

    expect(
      await db.query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, active.sourceDocumentId),
      })
    ).toBeUndefined();
    expect(await db.select().from(sourceDocumentRevisions)).toEqual([]);
    expect(await db.select().from(sourceDocumentFiles)).toEqual([]);
    expect(await db.select().from(ledgerEntries)).toEqual([]);
    expect(await db.select().from(storedFiles)).toHaveLength(1);
  });
});
