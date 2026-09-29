import { claimAttemptForTest } from "tests/helpers/processing-attempt";
import { listTargetSourceDocuments } from "@/modules/source-document/server/reads/list";
import { createPendingAttempt } from "tests/helpers/processing-attempt";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestUserWithLedger, testBookId, createTestRecord } from "tests/helpers/schema-setup";
import {
  ledgerEntries,
  sourceDocumentFiles,
  extractionAttempts,
  sourceDocuments,
  storedFiles,
} from "@/persistence";
import { activateAttempt } from "@/modules/source-document/server/projections/writes";
import { deleteSourceDocumentAtomically } from "@/modules/source-document/server/delete";
import { recordProcessingFailure } from "@/modules/source-document/server/extraction-attempts";

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
  it("creates, paginates, and preserves attempt state", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);

    const first = await createPendingAttempt({
      input: { text: "first", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db),
    });
    await expect(
      createPendingAttempt({
        sourceDocumentId: first.document.id,
        input: { text: "duplicate", storedFileIds: [], documentDate: null },
        bookId: await testBookId(db),
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      recordProcessingFailure({
        lease: await claimAttemptForTest(first.attempt.id),
        sourceDocumentId: first.document.id,
        attemptId: first.attempt.id,
        failureKind: "processing_error",
        failureMessage: "processing failed",
        failureCode: "PROCESSING_UNAVAILABLE",
      })
    ).resolves.toBe(true);

    const retry = await createPendingAttempt({
      sourceDocumentId: first.document.id,
      input: { text: "retry", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db),
    });
    await expect(
      activateAttempt({
        lease: await claimAttemptForTest(retry.attempt.id),
        sourceDocumentId: first.document.id,
        attemptId: retry.attempt.id,
        entries: [projectionEntry],
      })
    ).resolves.toBe(true);

    const failedRetry = await createPendingAttempt({
      sourceDocumentId: first.document.id,
      input: { text: "bad retry", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db),
    });
    await recordProcessingFailure({
      lease: await claimAttemptForTest(failedRetry.attempt.id),
      sourceDocumentId: first.document.id,
      attemptId: failedRetry.attempt.id,
      failureKind: "invalid_input",
      failureMessage: "unreadable",
    });
    const preserved = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, first.document.id),
    });
    expect(preserved).toMatchObject({ latestAttemptId: failedRetry.attempt.id });
    // The failed retry leaves the entries of the completed one in place.
    expect(
      await db.query.ledgerEntries.findMany({
        where: eq(ledgerEntries.sourceDocumentId, first.document.id),
      })
    ).toEqual([expect.objectContaining({ amount: "12.500" })]);

    const second = await createPendingAttempt({
      input: { text: "second", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db),
    });
    const page1 = await listTargetSourceDocuments({ limit: 1 });
    const page2 = await listTargetSourceDocuments({
      limit: 1,
      cursor: page1.nextCursor!,
    });
    expect([page1.items[0]?.id, page2.items[0]?.id].sort()).toEqual(
      [first.document.id, second.document.id].sort()
    );
  });

  it("replaces a reparsed document's entries without leaving the old rows behind", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);
    const bookId = await testBookId(db);
    const first = await createPendingAttempt({
      input: { text: "first", storedFileIds: [], documentDate: null },
      bookId,
    });
    await activateAttempt({
      lease: await claimAttemptForTest(first.attempt.id),
      sourceDocumentId: first.document.id,
      attemptId: first.attempt.id,
      entries: [projectionEntry, projectionEntry],
    });
    const reparse = await createPendingAttempt({
      sourceDocumentId: first.document.id,
      input: { text: "reparse", storedFileIds: [], documentDate: null },
      bookId,
    });
    await activateAttempt({
      lease: await claimAttemptForTest(reparse.attempt.id),
      sourceDocumentId: first.document.id,
      attemptId: reparse.attempt.id,
      entries: [{ ...projectionEntry, amount: "20.00" }],
    });

    expect(
      await db.query.ledgerEntries.findMany({
        where: eq(ledgerEntries.sourceDocumentId, first.document.id),
      })
    ).toEqual([expect.objectContaining({ amount: "20.000" })]);
  });

  it("deletes a document with everything it owns but its stored files, and refuses late completion", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);
    const active = await createTestRecord(getTestDb(), {
      entries: [projectionEntry],
      bookId: await testBookId(db),
    });
    const [file] = await db
      .insert(storedFiles)
      .values({
        storageKey: "stored/pending-evidence",
        contentType: "image/jpeg",
        byteSize: 7,
        finalizedAt: new Date(),
      })
      .returning();
    const pending = await createPendingAttempt({
      sourceDocumentId: active.sourceDocumentId,
      input: { text: null, storedFileIds: [file!.id], documentDate: null },
      bookId: await testBookId(db),
    });
    expect(pending.document.supportedActions).toEqual([
      "cancel_processing",
      "retry",
      "edit_retry",
      "delete",
    ]);
    const pendingLease = await claimAttemptForTest(pending.attempt.id);
    expect(await db.select().from(sourceDocumentFiles)).toHaveLength(1);

    await expect(
      deleteSourceDocumentAtomically({
        sourceDocumentId: active.sourceDocumentId,
      })
    ).resolves.toMatchObject({ deleted: true });
    await expect(
      deleteSourceDocumentAtomically({
        sourceDocumentId: active.sourceDocumentId,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      activateAttempt({
        lease: pendingLease,
        sourceDocumentId: active.sourceDocumentId,
        attemptId: pending.attempt.id,
        entries: [{ ...projectionEntry, amount: "99.00" }],
      })
    ).resolves.toBe(false);

    expect(
      await db.query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, active.sourceDocumentId),
      })
    ).toBeUndefined();
    expect(await db.select().from(extractionAttempts)).toEqual([]);
    expect(await db.select().from(sourceDocumentFiles)).toEqual([]);
    expect(await db.select().from(ledgerEntries)).toEqual([]);
    expect(await db.select().from(storedFiles)).toHaveLength(1);
  });
});
