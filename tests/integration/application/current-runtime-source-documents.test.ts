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
  revisionFiles,
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
    expect(preserved).toMatchObject({
      activeRevisionId: retry.revision.id,
      latestSubmissionRevisionId: failedRetry.revision.id,
    });

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

  it("soft deletes active and pending documents without removing evidence or accepting late completion", async () => {
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
    const revisionCount = (await db.select().from(sourceDocumentRevisions)).length;
    const fileLinkCount = (await db.select().from(revisionFiles)).length;

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
