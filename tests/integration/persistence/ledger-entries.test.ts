import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { entryCategories as categories, ledgerEntries, sourceDocuments } from "@/persistence";
import { createTestLedger, createTestSourceDocument } from "tests/helpers/schema-setup";

/**
 * FK Constraint Tests for LedgerEntries
 *
 * These tests verify schema-level foreign key behaviors that are not covered
 * by integration tests. Basic CRUD operations are tested through Server Actions
 * in tests/integration/modules/ledger/server{,-actions}/ledger-entries*.test.ts
 */
describe("LedgerEntries FK Constraints", () => {
  it("should cascade delete ledger entries when their source document is deleted", async () => {
    const db = getTestDb();
    await createTestLedger(db);

    const sourceDocId = await createTestSourceDocument(db);

    const [entry] = await db
      .insert(ledgerEntries)
      .values({
        sourceDocumentId: sourceDocId,
        amount: "25.00",
        currency: "CNY",
        itemName: "Will Be Deleted",
      })
      .returning({ id: ledgerEntries.id });

    await db.delete(sourceDocuments).where(eq(sourceDocuments.id, sourceDocId));

    const orphaned = await db.query.ledgerEntries.findMany({
      where: eq(ledgerEntries.id, entry!.id),
    });

    expect(orphaned).toHaveLength(0);
  });

  it("should set categoryId to null when category is deleted", async () => {
    const db = getTestDb();
    await createTestLedger(db);

    const [category] = await db
      .insert(categories)
      .values({
        name: "餐饮",
        sortOrder: 1,
      })
      .returning();

    const sourceDocId = await createTestSourceDocument(db);

    expect(category).toBeDefined();
    if (category == null) {
      throw new Error("Expected category to be created");
    }

    const [tx] = await db
      .insert(ledgerEntries)
      .values({
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
