import { claimRevisionForTest } from "tests/helpers/processing-revision";
import { describe, expect, it } from "vitest";
import { createProcessingRevisionInTransaction } from "@/modules/source-document/server/revisions";
import { getTargetSourceDocument } from "@/modules/source-document/server/reads/list";
import { createTestUserWithLedger, testBookId } from "tests/helpers/schema-setup";
import { getTestDb } from "tests/setup";
import { createManualDocument } from "@/modules/source-document/server/projections/writes";
import { recordProcessingFailure } from "@/modules/source-document/server/revisions";
import { getSourceDocumentInput } from "@/modules/source-document/server/reads/input";
import { submitSourceDocument } from "@/modules/source-document/server/submissions";
import { listLedgerEntries } from "@/modules/ledger/server/list-entries";
import { addLedgerEntry } from "@/modules/source-document/server/entry-commands";
import { storedFiles } from "@/persistence";

const activeEntry = {
  categoryId: null,
  amount: "12.50",
  currency: "CNY",
  itemName: "Lunch",
  description: null,
} as const;

/**
 * Set up a document with entries and a failed/anomalous retry.
 */
async function setupDocumentWithFailedRetry(
  db: ReturnType<typeof getTestDb>,
  ledgerId: string,
  failureKind: "invalid_input" | "processing_error"
) {
  // Step 1: Create a document with entries
  const bookId = await testBookId(db, ledgerId);
  const created = await createManualDocument({
    ledgerId,
    title: "Original",
    entryDate: "2026-07-15",
    inputText: "Original text",
    entries: [activeEntry],
    bookId,
  });

  // Step 2: Create a pending revision (processing)
  const pending = await db.transaction(async (tx) => {
    return createProcessingRevisionInTransaction(tx, {
      ledgerId,
      sourceDocumentId: created.sourceDocumentId,
      input: { text: "Retry text", storedFileIds: [], documentDate: null },
    });
  });

  // Step 3: Set the pending revision outcome to invalid/failed
  await recordProcessingFailure({
    lease: await claimRevisionForTest(pending.revision.id),
    ledgerId,
    sourceDocumentId: created.sourceDocumentId,
    revisionId: pending.revision.id,
    failureKind,
    failureMessage: failureKind === "invalid_input" ? "Validation invalid" : "Processing failed",
  });

  return {
    sourceDocumentId: created.sourceDocumentId,
    latestSubmissionRevisionId: pending.revision.id,
  };
}

/**
 * Set up a document with ONLY a failed/anomalous submission (no entries).
 * Simulates a first-parse failure.
 */
async function setupDocumentWithFirstParseFailure(
  db: ReturnType<typeof getTestDb>,
  ledgerId: string,
  failureKind: "invalid_input" | "processing_error"
) {
  const bookId = await testBookId(db, ledgerId);
  const pending = await db.transaction((tx) =>
    createProcessingRevisionInTransaction(tx, {
      ledgerId,
      bookId,
      input: { text: "First parse", storedFileIds: [], documentDate: null },
    })
  );
  await recordProcessingFailure({
    lease: await claimRevisionForTest(pending.revision.id),
    ledgerId,
    sourceDocumentId: pending.document.id,
    revisionId: pending.revision.id,
    failureKind,
    failureMessage: failureKind === "invalid_input" ? "First parse invalid" : "Processing failed",
  });
  return { sourceDocumentId: pending.document.id, latestSubmissionRevisionId: pending.revision.id };
}

describe("retry active result summary", () => {
  it("includes the active result summary for terminal retries", async () => {
    const db = getTestDb();
    for (const failureKind of ["invalid_input", "processing_error"] as const) {
      const { ledgerId } = await createTestUserWithLedger(
        db,
        `retry-${failureKind}-detail@example.com`,
        undefined,
        crypto.randomUUID()
      );
      const { sourceDocumentId } = await setupDocumentWithFailedRetry(db, ledgerId, failureKind);

      const detail = await getTargetSourceDocument(ledgerId, sourceDocumentId);
      expect(detail).toMatchObject({
        processingStatus: "failed",
        failureKind,
        activeResultSummary: { entryCount: 1, total: "12.50" },
      });
    }
  });

  it("omits the active result summary when the failed first parse left no entries", async () => {
    const db = getTestDb();
    for (const failureKind of ["invalid_input", "processing_error"] as const) {
      const { ledgerId } = await createTestUserWithLedger(
        db,
        `retry-first-${failureKind}@example.com`,
        undefined,
        crypto.randomUUID()
      );
      const { sourceDocumentId } = await setupDocumentWithFirstParseFailure(
        db,
        ledgerId,
        failureKind
      );

      const detail = await getTargetSourceDocument(ledgerId, sourceDocumentId);
      expect(detail).toMatchObject({ processingStatus: "failed", failureKind });
      expect(detail?.activeResultSummary).toBeUndefined();
    }
  });

  it("lets a document whose first parse failed be completed by hand", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const { sourceDocumentId } = await setupDocumentWithFirstParseFailure(
      db,
      ledgerId,
      "processing_error"
    );
    const failed = await getTargetSourceDocument(ledgerId, sourceDocumentId);
    expect(failed).toMatchObject({ processingStatus: "failed", canEdit: true, ledgerEntries: [] });

    const { ledgerEntryId } = await addLedgerEntry({
      ledgerId,
      sourceDocumentId,
      amount: "18",
      currency: "CNY",
      itemName: "Taxi",
    });

    const edited = await getTargetSourceDocument(ledgerId, sourceDocumentId);
    expect(edited).toMatchObject({
      processingStatus: "failed",
      canEdit: true,
      text: "First parse",
      ledgerEntries: [expect.objectContaining({ id: ledgerEntryId, itemName: "Taxi" })],
      activeResultSummary: { entryCount: 1, total: "18.00" },
    });
    expect(edited?.version).toBe(failed!.version + 1);
  });

  it("keeps the previous entries when an edit-retry fails while showing its input and failure", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const created = await createManualDocument({
      ledgerId,
      title: "Original",
      entryDate: "2026-07-15",
      inputText: "Original text",
      entries: [activeEntry],
      bookId: await testBookId(db, ledgerId),
    });
    const [file] = await db
      .insert(storedFiles)
      .values({
        ledgerId,
        storageKey: `${ledgerId}/stored/edited-evidence`,
        contentType: "image/jpeg",
        byteSize: 7,
        finalizedAt: new Date(),
      })
      .returning();
    const editRetry = await submitSourceDocument({
      ledgerId,
      sourceDocumentId: created.sourceDocumentId,
      inheritInput: false,
      supersedeProcessing: true,
      input: { text: "Edited text", storedFileIds: [file!.id], documentDate: null },
    });
    await recordProcessingFailure({
      lease: await claimRevisionForTest(editRetry.revision.id),
      ledgerId,
      sourceDocumentId: created.sourceDocumentId,
      revisionId: editRetry.revision.id,
      failureKind: "processing_error",
      failureMessage: "Processing failed",
    });

    const stream = await listLedgerEntries(ledgerId, { limit: 20 });
    expect(stream.items).toEqual([
      expect.objectContaining({ itemName: "Lunch", amount: "12.500" }),
    ]);
    const detail = await getTargetSourceDocument(ledgerId, created.sourceDocumentId);
    expect(detail).toMatchObject({
      text: "Edited text",
      files: [expect.objectContaining({ id: file!.id })],
      processingStatus: "failed",
      failureKind: "processing_error",
      canEdit: true,
      ledgerEntries: [expect.objectContaining({ itemName: "Lunch" })],
      activeResultSummary: { entryCount: 1, total: "12.50" },
    });
    await expect(getSourceDocumentInput(ledgerId, created.sourceDocumentId)).resolves.toMatchObject(
      {
        text: "Edited text",
        files: [expect.objectContaining({ id: file!.id })],
        processingStatus: "failed",
      }
    );
  });

  it("activeResultSummary reflects accurate count and total with multiple entries", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db, "retry-multi-entry");

    // Create a manual document with multiple entries
    const created = await createManualDocument({
      ledgerId,
      title: "Multi-entry",
      entryDate: "2026-07-15",
      inputText: "Multi entry doc",
      entries: [
        {
          categoryId: null,
          amount: "9007199254740992.01",
          currency: "CNY",
          itemName: "Item 1",
          description: null,
        },
        {
          categoryId: null,
          amount: "0.01",
          currency: "CNY",
          itemName: "Item 2",
          description: null,
        },
        {
          categoryId: null,
          amount: "0.01",
          currency: "CNY",
          itemName: "Item 3",
          description: null,
        },
      ],
      bookId: await testBookId(db, ledgerId),
    });

    // Create a failed pending revision
    const pending = await db.transaction(async (tx) => {
      return createProcessingRevisionInTransaction(tx, {
        ledgerId,
        sourceDocumentId: created.sourceDocumentId,
        input: { text: "Failed retry", storedFileIds: [], documentDate: null },
      });
    });
    await recordProcessingFailure({
      lease: await claimRevisionForTest(pending.revision.id),
      ledgerId,
      sourceDocumentId: created.sourceDocumentId,
      revisionId: pending.revision.id,
      failureKind: "processing_error",
      failureMessage: "Processing failed",
    });

    const detail = await getTargetSourceDocument(ledgerId, created.sourceDocumentId);
    expect(detail?.processingStatus).toBe("failed");
    expect(detail?.activeResultSummary).toBeDefined();
    expect(detail?.activeResultSummary?.entryCount).toBe(3);
    expect(detail?.activeResultSummary?.total).toBe("9007199254740992.03");
  });
});
