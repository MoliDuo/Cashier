import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { cancelSourceDocumentProcessing } from "@/modules/source-document/server/cancel-processing";
import { ledgerEntries, extractionAttempts, sourceDocuments } from "@/persistence";
import { createTestUserWithLedger, testBookId, createTestRecord } from "tests/helpers/schema-setup";
import { getTestDb } from "tests/setup";
import { submitSourceDocument } from "@/modules/source-document/server/submissions";
import { processingJobs } from "tests/helpers/processing-jobs";

describe("cancel source-document processing", () => {
  it("retains the latest submission input and fences out the running worker", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);
    const submission = await submitSourceDocument({
      input: { text: "Lunch 12 CNY", storedFileIds: [], documentDate: "2026-09-10" },
      bookId: await testBookId(db),
    });
    const processing = processingJobs();
    const claim = await processing.claim(submission.attempt.id);
    expect(claim).not.toBeNull();

    await expect(cancelSourceDocumentProcessing(submission.document.id)).resolves.toEqual({
      processingStatus: "cancelled",
    });

    const [document, attempt] = await Promise.all([
      db.query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, submission.document.id),
      }),
      db.query.extractionAttempts.findFirst({
        where: eq(extractionAttempts.id, submission.attempt.id),
      }),
    ]);
    expect(document?.latestAttemptId).toBe(submission.attempt.id);
    expect(document?.version).toBe(submission.document.version);
    expect(document?.inputText).toBe("Lunch 12 CNY");
    expect(attempt).toMatchObject({
      status: "cancelled",
      requestedDate: "2026-09-10",
    });
    await expect(processing.renew(submission.attempt.id, claim!.claimToken)).resolves.toBeNull();
    await expect(processing.claim(submission.attempt.id)).resolves.toBeNull();
  });

  it("keeps the previous entries when a retry is cancelled", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);
    const active = await createTestRecord(getTestDb(), {
      entries: [
        {
          categoryId: null,
          amount: "12.00",
          currency: "CNY",
          itemName: "Original",
          description: null,
        },
      ],
      bookId: await testBookId(db),
    });
    const retry = await submitSourceDocument({
      sourceDocumentId: active.sourceDocumentId,
      supersedeProcessing: true,
      input: { text: "Replacement", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db),
    });

    await cancelSourceDocumentProcessing(active.sourceDocumentId);
    const after = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, active.sourceDocumentId),
    });
    expect(after?.latestAttemptId).toBe(retry.attempt.id);
    expect(
      await db.query.ledgerEntries.findMany({
        where: eq(ledgerEntries.sourceDocumentId, active.sourceDocumentId),
      })
    ).toEqual([expect.objectContaining({ itemName: "Original" })]);
  });
});
