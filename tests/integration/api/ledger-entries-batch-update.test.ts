import { describe, it, expect, beforeEach, vi } from "vitest";
import { batchUpdateLedgerEntriesAction } from "@/modules/ledger/server-actions/entries";
import { getTestDb } from "../../setup";
import { ledgerEntries, entryCategories, ledgers } from "@/persistence";
import { inArray, eq } from "drizzle-orm";
import {
  createTestUserWithLedger,
  createTestSourceDocument,
  activateTestSourceDocumentProjection,
  TEST_USER_ID,
} from "../../helpers/schema-setup";

vi.mock("@/modules/currency/server/exchange-rates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/currency/server/exchange-rates")>()),
  convertAmounts: vi.fn(async (items: Array<{ amount: string }>) =>
    items.map((item) => ({ convertedAmount: item.amount, exchangeRate: "1" }))
  ),
}));

describe("Batch Update Ledger Entries Action", () => {
  let testLedgerId: string;
  let testEntryIds: string[];
  let testCategoryId: string;
  let testSourceDocId: string;

  beforeEach(async () => {
    const db = getTestDb();

    await db.delete(ledgers).where(eq(ledgers.userId, TEST_USER_ID));
    const { ledgerId } = await createTestUserWithLedger(db, undefined, "Test Ledger", TEST_USER_ID);
    testLedgerId = ledgerId;

    const [category] = await db
      .insert(entryCategories)
      .values({ ledgerId: testLedgerId, name: "Dining", sortOrder: 1 })
      .returning();
    expect(category).toBeDefined();
    if (category == null) {
      throw new Error("Expected category to be created");
    }
    testCategoryId = category.id;

    // Create a test source document for entries
    testSourceDocId = await createTestSourceDocument(db, testLedgerId);

    const entries = await db
      .insert(ledgerEntries)
      .values([
        {
          ledgerId: testLedgerId,
          sourceDocumentId: testSourceDocId,
          amount: "100",
          currency: "CNY",
          itemName: "Item 1",
          description: "Initial description 1",
        },
        {
          ledgerId: testLedgerId,
          sourceDocumentId: testSourceDocId,
          amount: "200",
          currency: "CNY",
          itemName: "Item 2",
          description: "Initial description 2",
        },
      ])
      .returning();
    testEntryIds = entries.map((e) => e.id);
    await activateTestSourceDocumentProjection(db, testSourceDocId);
  });

  it("should batch update category and currency", async () => {
    // batchUpdateLedgerEntriesAction returns void in new format
    await batchUpdateLedgerEntriesAction(
      [{ sourceDocumentId: testSourceDocId, expectedVersion: 1 }],
      testEntryIds,
      {
        categoryId: testCategoryId,
        currency: "USD",
      }
    );

    // Verify in DB
    const db = getTestDb();
    const updatedEntries = await db
      .select()
      .from(ledgerEntries)
      .where(inArray(ledgerEntries.id, testEntryIds));

    expect(updatedEntries).toHaveLength(2);
    updatedEntries.forEach((entry) => {
      expect(entry.categoryId).toBe(testCategoryId);
      expect(entry.currency).toBe("USD");
    });
  });

  it("normalizes a cleared currency to the ledger main currency", async () => {
    await batchUpdateLedgerEntriesAction(
      [{ sourceDocumentId: testSourceDocId, expectedVersion: 1 }],
      testEntryIds,
      { currency: null }
    );

    const updatedEntries = await getTestDb()
      .select()
      .from(ledgerEntries)
      .where(inArray(ledgerEntries.id, testEntryIds));

    expect(updatedEntries).toHaveLength(2);
    expect(updatedEntries.every((entry) => entry.currency === "CNY")).toBe(true);
  });

  it("should batch update description", async () => {
    const newDescription = "Batch updated description";

    // batchUpdateLedgerEntriesAction returns void in new format
    await batchUpdateLedgerEntriesAction(
      [{ sourceDocumentId: testSourceDocId, expectedVersion: 1 }],
      testEntryIds,
      {
        description: newDescription,
      }
    );

    // Verify in DB
    const db = getTestDb();
    const updatedEntries = await db
      .select()
      .from(ledgerEntries)
      .where(inArray(ledgerEntries.id, testEntryIds));

    expect(updatedEntries).toHaveLength(2);
    updatedEntries.forEach((entry) => {
      expect(entry.description).toBe(newDescription);
    });
  });
});
