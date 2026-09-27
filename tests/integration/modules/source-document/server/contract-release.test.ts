import { claimAttemptForTest } from "tests/helpers/processing-attempt";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getTargetSourceDocument } from "@/modules/source-document/server/reads/list";
import { ledgerEntries, extractionAttempts, sourceDocuments } from "@/persistence";
import { createTestUserWithLedger, testBookId } from "tests/helpers/schema-setup";
import { getTestDb } from "tests/setup";
import {
  activateAttempt,
  createManualDocument,
} from "@/modules/source-document/server/projections/writes";
import { submitSourceDocument } from "@/modules/source-document/server/submissions";

const projectionEntry = {
  categoryId: null,
  amount: "12.50",
  currency: "CNY",
  itemName: "Lunch",
  description: null,
  convertedAmount: "12.50",
  exchangeRate: "1.000000",
} as const;

describe("local contract release", () => {
  it("writes only target attempt, processing, and ledger projections", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const pending = await submitSourceDocument({
      ledgerId,
      input: { text: "Lunch 12.50", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });
    const created = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, pending.document.id),
    });
    expect(created).not.toBeNull();
    expect(created?.latestAttemptId).toBe(pending.attempt.id);

    await expect(
      activateAttempt({
        lease: await claimAttemptForTest(pending.attempt.id),
        ledgerId,
        sourceDocumentId: pending.document.id,
        attemptId: pending.attempt.id,
        title: "Target title",
        entries: [projectionEntry],
      })
    ).resolves.toBe(true);

    const completed = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, pending.document.id),
    });
    expect(completed).toMatchObject({
      latestAttemptId: pending.attempt.id,
      title: "Target title",
    });
    await expect(
      db.query.extractionAttempts.findFirst({
        where: eq(extractionAttempts.id, pending.attempt.id),
      })
    ).resolves.toMatchObject({ status: "completed", claimToken: null });
    expect(await db.select().from(ledgerEntries)).toHaveLength(1);
  });

  it("derives a manual document without submission processing state", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const created = await createManualDocument({
      ledgerId,
      inputText: "target attempt text",
      entries: [projectionEntry],
      bookId: await testBookId(db, ledgerId),
    });

    await expect(
      getTargetSourceDocument(ledgerId, created.sourceDocumentId)
    ).resolves.toMatchObject({
      id: created.sourceDocumentId,
      processingStatus: null,
    });
  });
});
