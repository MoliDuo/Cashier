import { describe, it, expect, beforeEach, vi } from "vitest";
import { createSourceDocumentAction } from "@/modules/source-document/server-actions/create";
import { deleteSourceDocumentAction } from "@/modules/source-document/server-actions/delete";
import { getTestDb } from "../../setup";
import {
  entryCategories as categories,
  ledgerEntries,
  sourceDocumentRevisions,
  sourceDocuments,
  ledgers,
} from "@/persistence";
import { eq } from "drizzle-orm";
import { createTestUserWithLedger, TEST_USER_ID } from "../../helpers/schema-setup";
import { createOpenAIMock } from "../../helpers/mocks/openai";

// Mock OpenAI
vi.mock("@/lib/ai/openai-client", () => ({
  getOpenAIClient: vi.fn(),
  resetOpenAIClient: vi.fn(),
}));

import { getOpenAIClient } from "@/lib/ai/openai-client";
import { processAllPendingTasks } from "../../helpers/processing";

describe("SourceDocument Actions", () => {
  let testLedgerId: string;
  let testCategoryId: string;

  function firstItem<T>(items: T[], errorMessage: string): T {
    const first = items[0];
    if (first == null) {
      throw new Error(errorMessage);
    }
    return first;
  }

  const createDocument = (input: Parameters<typeof createSourceDocumentAction>[0]) =>
    createSourceDocumentAction(input, crypto.randomUUID());

  beforeEach(async () => {
    // Reset mock to use multi-stage mock by default
    vi.mocked(getOpenAIClient).mockReturnValue(
      createOpenAIMock() as unknown as ReturnType<typeof getOpenAIClient>
    );

    const db = getTestDb();

    // Clean up existing ledger for TEST_USER_ID and create new one
    await db.delete(ledgers);
    const { ledgerId } = await createTestUserWithLedger(db, undefined, "Test Ledger", TEST_USER_ID);
    testLedgerId = ledgerId;

    const newCat = firstItem(
      await db
        .insert(categories)
        .values({
          name: "餐饮",
          description: "外卖、堂食",
          sortOrder: 1,
          ledgerId: testLedgerId,
        })
        .returning(),
      "Expected category to be created in setup"
    );
    testCategoryId = newCat.id;

    // Ensure '水果' category exists for the notes test
    await db.insert(categories).values({
      name: "水果",
      description: "Fresh Fruit",
      sortOrder: 2,
      ledgerId: testLedgerId,
    });
  });

  it("should persist ledger entries with notes", async () => {
    // Override mock for this test with custom entries
    vi.mocked(getOpenAIClient).mockReturnValue(
      createOpenAIMock({
        categories: ["水果"],
        entries: [
          {
            item_name: "苹果",
            amount: "20",
            currency: "CNY",
            category_index: 1,
            notes: "2kg * 10元/kg, 红富士苹果",
          },
        ],
      }) as unknown as ReturnType<typeof getOpenAIClient>
    );

    const result = await createDocument({
      text: "苹果2公斤，每公斤10元",
    });

    expect(result).toMatchObject({ version: 1, status: "processing" });

    // Process
    await processAllPendingTasks();

    const db = getTestDb();
    const savedEntry = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.sourceDocumentId, result.sourceDocumentId),
    });

    expect(savedEntry).toBeDefined();
    expect(savedEntry?.itemName).toBe("苹果");
    // Ensure notes are saved in description
    expect(savedEntry?.description).toContain("2kg");
    expect(savedEntry?.description).toContain("10元");
  });

  it("should process text message and create ledger entry", async () => {
    const result = await createDocument({ text: "午餐花了25.5元" });
    expect(result.sourceDocumentId).toBeDefined();
    expect(result).toMatchObject({ version: 1, status: "processing" });

    // Process
    await processAllPendingTasks();

    const db = getTestDb();
    const savedEntries = await db.query.ledgerEntries.findMany({
      where: eq(ledgerEntries.sourceDocumentId, result.sourceDocumentId!),
    });

    expect(savedEntries).toHaveLength(1);
    const savedEntry = firstItem(savedEntries, "Expected one saved ledger entry");
    expect(savedEntry.itemName).toBe("午餐");
    expect(savedEntry.amount).toBe("25.500");
  });

  it("should match category by index", async () => {
    const result = await createDocument({ text: "午餐" });
    expect(result).toMatchObject({ version: 1, status: "processing" });

    // Process
    await processAllPendingTasks();

    const db = getTestDb();
    const savedEntries = await db.query.ledgerEntries.findMany({
      where: eq(ledgerEntries.sourceDocumentId, result.sourceDocumentId!),
      with: { category: true },
    });

    expect(savedEntries).toHaveLength(1);
    const savedEntry = firstItem(savedEntries, "Expected one categorized ledger entry");
    expect(savedEntry.categoryId).toBe(testCategoryId);
    expect(savedEntry.category).toBeDefined();
    expect(savedEntry.category?.name).toBe("餐饮");
  });

  it("should save input message with AI response", async () => {
    const result = await createDocument({ text: "午餐25元" });

    const db = getTestDb();
    const savedDoc = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, result.sourceDocumentId!),
    });

    expect(savedDoc).toBeDefined();
    expect(savedDoc).not.toHaveProperty("text");
    expect(savedDoc).not.toHaveProperty("imageUrls");
    expect(savedDoc?.inputText).toBe("午餐25元");
    const revision = await db.query.sourceDocumentRevisions.findFirst({
      where: eq(sourceDocumentRevisions.sourceDocumentId, result.sourceDocumentId!),
    });
    expect(revision?.processingStatus).toBe("processing");

    // Process tasks to ensure cleanup
    await processAllPendingTasks();
  });

  it("replays a browser create without duplicating persisted work", async () => {
    const clientSubmissionId = crypto.randomUUID();
    const input = { text: "Idempotent lunch 25" };

    const first = await createSourceDocumentAction(input, clientSubmissionId);
    const replay = await createSourceDocumentAction(input, clientSubmissionId);

    expect(replay).toEqual(first);
    const db = getTestDb();
    expect(
      await db.query.sourceDocuments.findMany({
        where: eq(sourceDocuments.id, first.sourceDocumentId),
      })
    ).toHaveLength(1);
    const revisions = await db.query.sourceDocumentRevisions.findMany({
      where: eq(sourceDocumentRevisions.sourceDocumentId, first.sourceDocumentId),
    });
    expect(revisions).toHaveLength(1);
    // The one revision is the document's single queued processing attempt.
    await expect(
      db.query.sourceDocuments.findFirst({ where: eq(sourceDocuments.id, first.sourceDocumentId) })
    ).resolves.toMatchObject({ latestSubmissionRevisionId: revisions[0]!.id });
  });

  it("should return error when no input provided", async () => {
    await expect(createSourceDocumentAction({}, crypto.randomUUID())).rejects.toThrow(
      "Content (text or images) is required"
    );
  });

  it("should delete source document and associated ledger entries", async () => {
    // 1. Create a message first
    const createRes = await createDocument({
      text: "待删除的项目 100元",
    });
    const sourceDocumentId = createRes.sourceDocumentId!;

    // Process
    await processAllPendingTasks();

    // Verify ledger entry exists
    const db = getTestDb();
    const entriesBefore = await db.query.ledgerEntries.findMany({
      where: eq(ledgerEntries.sourceDocumentId, sourceDocumentId),
    });
    expect(entriesBefore.length).toBeGreaterThan(0);

    // 2. DELETE request
    await deleteSourceDocumentAction(sourceDocumentId);

    // 3. Verify deletion
    const docAfter = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, sourceDocumentId),
    });
    expect(docAfter).toBeDefined();
    expect(docAfter?.deletedAt).not.toBeNull();

    const entriesAfter = await db.query.ledgerEntries.findMany({
      where: eq(ledgerEntries.sourceDocumentId, sourceDocumentId),
    });
    expect(entriesAfter.length).toBeGreaterThan(0);
    entriesAfter.forEach((entry) => {
      expect(entry.deletedAt).not.toBeNull();
    });
  });
});
