import { asc, eq, and } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { createSourceDocumentAction } from "@/modules/source-document/server-actions/create";
import {
  editRetrySourceDocumentAction,
  retrySourceDocumentAction,
} from "@/modules/source-document/server-actions/retry";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { getOpenAIClient } from "@/lib/ai/openai-client";
import { createOpenAIMock } from "tests/helpers/mocks/openai";
import { processAllPendingTasks } from "tests/helpers/processing";
import { createTestUserWithLedger, TEST_USER_ID } from "tests/helpers/schema-setup";
import { getTestDb } from "tests/setup";
import {
  entryCategories,
  ledgerEntries,
  ledgers,
  extractionAttempts,
  sourceDocuments,
} from "@/persistence";

vi.mock("@/lib/ai/openai-client", () => ({
  getOpenAIClient: vi.fn(),
  resetOpenAIClient: vi.fn(),
}));

describe("source-document retry action", () => {
  const createDocument = (text: string) =>
    createSourceDocumentAction({ text }, crypto.randomUUID());

  beforeEach(async () => {
    vi.mocked(getOpenAIClient).mockReturnValue(
      createOpenAIMock() as unknown as ReturnType<typeof getOpenAIClient>
    );
    const db = getTestDb();
    await db.delete(ledgers);
    await createTestUserWithLedger(db, undefined, "Retry Ledger", TEST_USER_ID);
    await db.insert(entryCategories).values({
      name: "餐饮",
      description: "餐饮服务",
      sortOrder: 1,
    });
  });

  it("reprocesses a new attempt while keeping the source-document identity stable", async () => {
    const db = getTestDb();
    const created = await createDocument("午餐 25元");
    await processAllPendingTasks();
    const before = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, created.sourceDocumentId),
    });
    expect(before?.latestAttemptId).not.toBeNull();
    await expect(
      db.query.extractionAttempts.findFirst({
        where: eq(extractionAttempts.id, before!.latestAttemptId!),
      })
    ).resolves.toMatchObject({ status: "completed" });

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
    const retried = await editRetrySourceDocumentAction(created.sourceDocumentId, {
      text: "晚餐 50元",
      storedFileIds: [],
      documentDate: null,
    });
    expect(retried).toEqual({ status: "processing" });
    await processAllPendingTasks();

    const after = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, created.sourceDocumentId),
    });
    const attempts = await db.query.extractionAttempts.findMany({
      where: eq(extractionAttempts.sourceDocumentId, created.sourceDocumentId),
      orderBy: asc(extractionAttempts.submittedAt),
    });
    const activeEntries = await db.query.ledgerEntries.findMany({
      where: and(eq(ledgerEntries.sourceDocumentId, created.sourceDocumentId)),
    });

    // The completed retry replaces the document's entries immediately.
    expect(after).toMatchObject({
      id: created.sourceDocumentId,
    });
    expect(after?.latestAttemptId).toBe(attempts[1]?.id);
    expect(after?.inputText).toBe("晚餐 50元");
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.status).toBe("completed");
    expect(attempts[1]?.status).toBe("completed");
    expect(activeEntries).toMatchObject([{ itemName: "晚餐" }]);
  });

  it("validates the document to retry and propagates a missing one", async () => {
    await expect(retrySourceDocumentAction("not-a-uuid")).rejects.toThrow(ValidationError);
    await expect(retrySourceDocumentAction(crypto.randomUUID())).rejects.toThrow(NotFoundError);
    expect(await getTestDb().select().from(extractionAttempts)).toEqual([]);
  });

  it("rejects raw image payloads that bypass upload finalization", async () => {
    const created = await createDocument("Lunch 25");
    await processAllPendingTasks();
    await expect(
      editRetrySourceDocumentAction(created.sourceDocumentId, {
        images: [{ data: "/api/uploads/private.jpg", mimeType: "image/jpeg" }],
      } as never)
    ).rejects.toThrow(ZodError);
  });

  it("retry succeeds despite a previous failed attempt, which kept the original entries", async () => {
    const db = getTestDb();

    // Step 1: Create a document and process it successfully
    const created = await createDocument("午餐 25元");
    await processAllPendingTasks();

    const before = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, created.sourceDocumentId),
    });
    const liveEntries = () =>
      db.query.ledgerEntries.findMany({
        where: and(eq(ledgerEntries.sourceDocumentId, created.sourceDocumentId)),
      });
    const originalEntries = await liveEntries();
    expect(originalEntries.length).toBeGreaterThan(0);

    // Step 2: Retry with a broken AI mock that causes processing failure
    vi.mocked(getOpenAIClient).mockReturnValue({
      generateContent: vi.fn().mockRejectedValue(new Error("AI service failure")),
    } as unknown as ReturnType<typeof getOpenAIClient>);

    await editRetrySourceDocumentAction(created.sourceDocumentId, {
      text: "修改 50元",
      storedFileIds: [],
      documentDate: null,
    });
    await processAllPendingTasks();

    // Step 3: Verify the previous entries are preserved despite the failed retry
    const afterFail = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, created.sourceDocumentId),
    });
    expect((await liveEntries()).map((entry) => entry.id).sort()).toEqual(
      originalEntries.map((entry) => entry.id).sort()
    );
    // Neither the retry submission nor the recorded failure changes saveable content.
    expect(afterFail?.version).toBe(before!.version);

    const attempts1 = await db.query.extractionAttempts.findMany({
      where: eq(extractionAttempts.sourceDocumentId, created.sourceDocumentId),
      orderBy: asc(extractionAttempts.submittedAt),
    });
    expect(attempts1).toHaveLength(2);
    expect(attempts1[0]?.status).toBe("completed");
    expect(attempts1[1]?.status).toBe("failed");

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

    const retried = await editRetrySourceDocumentAction(created.sourceDocumentId, {
      text: "晚餐 50元",
      storedFileIds: [],
      documentDate: null,
    });
    expect(retried).toEqual({ status: "processing" });
    await processAllPendingTasks();

    // Step 5: Verify final state: the successful retry replaces the entries.
    const afterRetry = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, created.sourceDocumentId),
    });

    const attempts2 = await db.query.extractionAttempts.findMany({
      where: eq(extractionAttempts.sourceDocumentId, created.sourceDocumentId),
      orderBy: asc(extractionAttempts.submittedAt),
    });
    expect(attempts2).toHaveLength(3);
    expect(attempts2[0]?.status).toBe("completed"); // original
    expect(attempts2[1]?.status).toBe("failed"); // failed retry
    expect(attempts2[2]?.status).toBe("completed");
    expect(afterRetry?.latestAttemptId).toBe(attempts2[2]?.id);

    expect(await liveEntries()).toMatchObject([{ itemName: "晚餐" }]);
  });
});
