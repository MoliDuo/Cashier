import { describe, expect, it } from "vitest";
import { postgresLedgerProjectionAdapter } from "@/application/adapters/postgres";
import {
  createProcessingRevisionInTransaction,
  postgresRevisionAdapter,
} from "@/application/adapters/postgres/revisions";
import { getTargetSourceDocument } from "@/application/adapters/postgres/source-document-reads";
import { createTestUserWithLedger, testBookId } from "tests/helpers/schema-setup";
import { getTestDb } from "tests/setup";

const activeEntry = {
  categoryId: null,
  amount: "12.50",
  currency: "CNY",
  itemName: "Lunch",
  description: null,
  convertedAmount: "12.50",
  exchangeRate: "1.000000",
} as const;

/**
 * Set up a document with an active revision and a failed/anomalous pending revision.
 */
async function setupDocumentWithFailedRetry(
  db: ReturnType<typeof getTestDb>,
  ledgerId: string,
  failureKind: "invalid_input" | "processing_error"
) {
  // Step 1: Create a document with an active revision and entries
  const bookId = await testBookId(db, ledgerId);
  const created = await postgresLedgerProjectionAdapter.createManual({
    expectedMainCurrency: "CNY",
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
  await postgresRevisionAdapter.recordProcessingFailure({
    ledgerId,
    sourceDocumentId: created.sourceDocumentId,
    revisionId: pending.revision.id,
    failureKind,
    failureMessage: failureKind === "invalid_input" ? "Validation invalid" : "Processing failed",
  });

  return {
    sourceDocumentId: created.sourceDocumentId,
    activeRevisionId: created.revisionId,
    latestSubmissionRevisionId: pending.revision.id,
  };
}

/**
 * Set up a document with ONLY a failed/anomalous pending revision (no active revision).
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
  await postgresRevisionAdapter.recordProcessingFailure({
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

  it("omits the active result summary when the first parse has no active revision", async () => {
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

  it("activeResultSummary reflects accurate count and total with multiple entries", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db, "retry-multi-entry");

    // Create a manual document with multiple entries
    const created = await postgresLedgerProjectionAdapter.createManual({
      expectedMainCurrency: "CNY",
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
          convertedAmount: "9007199254740992.01",
          exchangeRate: "1.000000",
        },
        {
          categoryId: null,
          amount: "0.01",
          currency: "CNY",
          itemName: "Item 2",
          description: null,
          convertedAmount: "0.01",
          exchangeRate: "1.000000",
        },
        {
          categoryId: null,
          amount: "0.01",
          currency: "CNY",
          itemName: "Item 3",
          description: null,
          convertedAmount: "0.01",
          exchangeRate: "1.000000",
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
    await postgresRevisionAdapter.recordProcessingFailure({
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
