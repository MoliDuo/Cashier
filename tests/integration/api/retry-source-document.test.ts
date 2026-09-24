import { asc, eq, isNull, and } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { createSourceDocumentAction } from "@/modules/source-document/server-actions/create";
import { editRetrySourceDocumentAction } from "@/modules/source-document/server-actions/retry";
import { getOpenAIClient } from "@/lib/ai/openai-client";
import { createOpenAIMock } from "../../helpers/mocks/openai";
import { processAllPendingTasks } from "../../helpers/processing";
import { createTestUserWithLedger, TEST_USER_ID } from "../../helpers/schema-setup";
import { getTestDb } from "../../setup";
import {
  entryCategories,
  ledgerEntries,
  ledgers,
  sourceDocumentRevisions,
  sourceDocuments,
} from "@/persistence";

vi.mock("@/lib/ai/openai-client", () => ({
  getOpenAIClient: vi.fn(),
  resetOpenAIClient: vi.fn(),
}));

describe("source-document retry action", () => {
  let ledgerId = "";

  const createDocument = (text: string) =>
    createSourceDocumentAction({ text }, crypto.randomUUID());

  beforeEach(async () => {
    vi.mocked(getOpenAIClient).mockReturnValue(
      createOpenAIMock() as unknown as ReturnType<typeof getOpenAIClient>
    );
    const db = getTestDb();
    await db.delete(ledgers).where(eq(ledgers.userId, TEST_USER_ID));
    ({ ledgerId } = await createTestUserWithLedger(db, undefined, "Retry Ledger", TEST_USER_ID));
    await db.insert(entryCategories).values({
      ledgerId,
      name: "餐饮",
      description: "餐饮服务",
      sortOrder: 1,
    });
  });

  it("reprocesses a new revision while keeping the source-document identity stable", async () => {
    const db = getTestDb();
    const created = await createDocument("午餐 25元");
    await processAllPendingTasks();
    const before = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, created.sourceDocumentId),
    });
    expect(before?.activeRevisionId).not.toBeNull();
    await expect(
      db.query.sourceDocumentRevisions.findFirst({
        where: eq(sourceDocumentRevisions.id, before!.activeRevisionId!),
      })
    ).resolves.toMatchObject({ processingStatus: "completed" });

    vi.mocked(getOpenAIClient).mockReturnValue(
      createOpenAIMock({
        title: "晚餐费用",
        entries: [
          {
            item_name: "晚餐",
            amount: "50",
            currency: "CNY",
            category_index: 1,
            entry_date: "2026-07-15",
          },
        ],
      }) as unknown as ReturnType<typeof getOpenAIClient>
    );
    const retried = await editRetrySourceDocumentAction(
      created.sourceDocumentId,
      { text: "晚餐 50元", storedFileIds: [], documentDate: null },
      before!.version
    );
    expect(retried).toEqual({
      ok: true,
      sourceDocumentId: created.sourceDocumentId,
      version: before!.version + 1,
      data: { status: "processing" },
    });
    await processAllPendingTasks();

    const after = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, created.sourceDocumentId),
    });
    const revisions = await db.query.sourceDocumentRevisions.findMany({
      where: eq(sourceDocumentRevisions.sourceDocumentId, created.sourceDocumentId),
      orderBy: asc(sourceDocumentRevisions.createdAt),
    });
    const activeEntries = await db.query.ledgerEntries.findMany({
      where: and(
        eq(ledgerEntries.sourceDocumentId, created.sourceDocumentId),
        eq(ledgerEntries.sourceDocumentRevisionId, after!.activeRevisionId!),
        isNull(ledgerEntries.deletedAt)
      ),
    });

    // The completed retry becomes the active result immediately.
    expect(after).toMatchObject({
      id: created.sourceDocumentId,
      deletedAt: null,
    });
    expect(after?.latestSubmissionRevisionId).not.toBeNull();
    expect(after?.activeRevisionId).toBe(after?.latestSubmissionRevisionId);
    expect(revisions).toHaveLength(2);
    expect(revisions[0]?.processingStatus).toBe("completed");
    expect(revisions[1]?.processingStatus).toBe("completed");
    expect(activeEntries).toMatchObject([{ itemName: "晚餐" }]);
  });

  it("rejects raw image payloads that bypass upload finalization", async () => {
    const db = getTestDb();
    const created = await createDocument("Lunch 25");
    await processAllPendingTasks();
    const before = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, created.sourceDocumentId),
    });
    await expect(
      editRetrySourceDocumentAction(
        created.sourceDocumentId,
        {
          images: [{ data: "/api/uploads/private.jpg", mimeType: "image/jpeg" }],
        } as never,
        before!.version
      )
    ).rejects.toThrow(ZodError);
  });

  it("retry succeeds despite a previous failed revision, preserving the original active revision", async () => {
    const db = getTestDb();

    // Step 1: Create a document and process it successfully
    const created = await createDocument("午餐 25元");
    await processAllPendingTasks();

    const before = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, created.sourceDocumentId),
    });
    expect(before?.activeRevisionId).not.toBeNull();
    const originalActiveRevisionId = before!.activeRevisionId;

    // Step 2: Retry with a broken AI mock that causes processing failure
    vi.mocked(getOpenAIClient).mockReturnValue({
      generateContent: vi.fn().mockRejectedValue(new Error("AI service failure")),
    } as unknown as ReturnType<typeof getOpenAIClient>);

    await editRetrySourceDocumentAction(
      created.sourceDocumentId,
      { text: "修改 50元", storedFileIds: [], documentDate: null },
      before!.version
    );
    await processAllPendingTasks();

    // Step 3: Verify the previous active revision is preserved despite the failed retry
    const afterFail = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, created.sourceDocumentId),
    });
    expect(afterFail?.activeRevisionId).toBe(originalActiveRevisionId);

    const revisions1 = await db.query.sourceDocumentRevisions.findMany({
      where: eq(sourceDocumentRevisions.sourceDocumentId, created.sourceDocumentId),
      orderBy: asc(sourceDocumentRevisions.createdAt),
    });
    expect(revisions1).toHaveLength(2);
    expect(revisions1[0]?.processingStatus).toBe("completed");
    expect(revisions1[1]?.processingStatus).toBe("failed");

    // Step 4: Retry a second time with a working AI mock
    vi.mocked(getOpenAIClient).mockReturnValue(
      createOpenAIMock({
        title: "晚餐费用",
        entries: [
          {
            item_name: "晚餐",
            amount: "50",
            currency: "CNY",
            category_index: 1,
            entry_date: "2026-07-15",
          },
        ],
      }) as unknown as ReturnType<typeof getOpenAIClient>
    );

    const retried = await editRetrySourceDocumentAction(
      created.sourceDocumentId,
      { text: "晚餐 50元", storedFileIds: [], documentDate: null },
      afterFail!.version
    );
    expect(retried).toMatchObject({ ok: true, data: { status: "processing" } });
    await processAllPendingTasks();

    // Step 5: Verify final state: the successful retry replaces the active result.
    const afterRetry = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, created.sourceDocumentId),
    });
    expect(afterRetry?.latestSubmissionRevisionId).not.toBeNull();
    expect(afterRetry?.activeRevisionId).toBe(afterRetry?.latestSubmissionRevisionId);
    expect(afterRetry?.activeRevisionId).not.toBe(originalActiveRevisionId);

    const revisions2 = await db.query.sourceDocumentRevisions.findMany({
      where: eq(sourceDocumentRevisions.sourceDocumentId, created.sourceDocumentId),
      orderBy: asc(sourceDocumentRevisions.createdAt),
    });
    expect(revisions2).toHaveLength(3);
    expect(revisions2[0]?.processingStatus).toBe("completed"); // original
    expect(revisions2[1]?.processingStatus).toBe("failed"); // failed retry
    expect(revisions2[2]?.processingStatus).toBe("completed");

    const activeEntries = await db.query.ledgerEntries.findMany({
      where: and(
        eq(ledgerEntries.sourceDocumentId, created.sourceDocumentId),
        eq(ledgerEntries.sourceDocumentRevisionId, afterRetry!.activeRevisionId!),
        isNull(ledgerEntries.deletedAt)
      ),
    });
    expect(activeEntries).toMatchObject([{ itemName: "晚餐" }]);
  });
});
