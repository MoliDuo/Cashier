import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  cancelSourceDocumentProcessing,
  postgresLedgerProjectionAdapter,
  postgresSourceDocumentSubmissionAdapter,
} from "@/application/adapters/postgres";
import { processingOutbox, sourceDocumentRevisions, sourceDocuments } from "@/persistence";
import { createTestUserWithLedger, testBookId } from "tests/helpers/schema-setup";
import { getTestDb } from "tests/setup";

describe("cancel source-document processing", () => {
  it("retains the latest submission input and terminates its task records", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const submission = await postgresSourceDocumentSubmissionAdapter.submit({
      ledgerId,
      input: { text: "Lunch 12 CNY", storedFileIds: [], documentDate: "2026-09-10" },
      bookId: await testBookId(db, ledgerId),
    });

    await expect(
      cancelSourceDocumentProcessing(ledgerId, submission.document.id, submission.document.version)
    ).resolves.toMatchObject({
      processingStatus: "cancelled",
      version: submission.document.version + 1,
    });

    const [document, revision, outbox] = await Promise.all([
      db.query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, submission.document.id),
      }),
      db.query.sourceDocumentRevisions.findFirst({
        where: eq(sourceDocumentRevisions.id, submission.revision.id),
      }),
      db.query.processingOutbox.findFirst({
        where: eq(processingOutbox.revisionId, submission.revision.id),
      }),
    ]);
    expect(document?.latestSubmissionRevisionId).toBe(submission.revision.id);
    expect(revision).toMatchObject({
      processingStatus: "cancelled",
      inputText: "Lunch 12 CNY",
      inputDocumentDate: "2026-09-10",
    });
    expect(outbox?.status).toBe("cancelled");
  });

  it("keeps the previous active result when a retry is cancelled", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const active = await postgresLedgerProjectionAdapter.createManual({
      ledgerId,
      expectedMainCurrency: "CNY",
      entries: [
        {
          categoryId: null,
          amount: "12.00",
          currency: "CNY",
          itemName: "Original",
          description: null,
          convertedAmount: "12.00",
          exchangeRate: "1",
        },
      ],
      bookId: await testBookId(db, ledgerId),
    });
    const before = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, active.sourceDocumentId),
    });
    const retry = await postgresSourceDocumentSubmissionAdapter.submit({
      ledgerId,
      sourceDocumentId: active.sourceDocumentId,
      expectedVersion: before!.version,
      supersedeProcessing: true,
      input: { text: "Replacement", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });

    await cancelSourceDocumentProcessing(ledgerId, active.sourceDocumentId, retry.document.version);
    const after = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, active.sourceDocumentId),
    });
    expect(after?.activeRevisionId).toBe(active.revisionId);
    expect(after?.latestSubmissionRevisionId).toBe(retry.revision.id);
  });
});
