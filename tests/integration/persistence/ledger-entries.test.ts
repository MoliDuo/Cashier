import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { ledgers, entryCategories as categories, ledgerEntries } from "@/persistence";
import { createTestUserWithLedger, createTestSourceDocument } from "tests/helpers/schema-setup";

/**
 * FK Constraint Tests for LedgerEntries
 *
 * These tests verify schema-level foreign key behaviors that are not covered
 * by integration tests. Basic CRUD operations are tested through Server Actions
 * in tests/integration/modules/ledger/server{,-actions}/ledger-entries*.test.ts
 */
describe("LedgerEntries FK Constraints", () => {
  it("should cascade delete ledger entries when ledger is deleted", async () => {
    const db = getTestDb();
    const { ledgerId: id } = await createTestUserWithLedger(db, "test8@example.com", "Test Ledger");
    const ledger = { id };

    const sourceDocId = await createTestSourceDocument(db, ledger.id);

    await db.insert(ledgerEntries).values({
      ledgerId: ledger.id,
      sourceDocumentId: sourceDocId,
      amount: "25.00",
      currency: "CNY",
      itemName: "Will Be Deleted",
    });

    await db.delete(ledgers).where(eq(ledgers.id, ledger.id));

    const orphaned = await db.query.ledgerEntries.findMany({
      where: eq(ledgerEntries.ledgerId, ledger.id),
    });

    expect(orphaned).toHaveLength(0);
  });

  it("should set categoryId to null when category is deleted", async () => {
    const db = getTestDb();
    const { ledgerId: id } = await createTestUserWithLedger(db, "test9@example.com", "Test Ledger");
    const ledger = { id };

    const [category] = await db
      .insert(categories)
      .values({
        ledgerId: ledger.id,
        name: "餐饮",
        sortOrder: 1,
      })
      .returning();

    const sourceDocId = await createTestSourceDocument(db, ledger.id);

    expect(category).toBeDefined();
    if (category == null) {
      throw new Error("Expected category to be created");
    }

    const [tx] = await db
      .insert(ledgerEntries)
      .values({
        ledgerId: ledger.id,
        sourceDocumentId: sourceDocId,
        categoryId: category.id,
        amount: "25.00",
        currency: "CNY",
        itemName: "午餐",
      })
      .returning();
    expect(tx).toBeDefined();
    if (tx == null) {
      throw new Error("Expected ledger entry");
    }

    await db.delete(categories).where(eq(categories.id, category.id));

    const found = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, tx.id),
    });

    expect(found).toBeDefined();
    expect(found?.categoryId).toBeNull();
  });
});
