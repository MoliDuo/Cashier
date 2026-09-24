import { sql } from "drizzle-orm";
import { describe, it, expect, beforeEach } from "vitest";
import { getTestDb } from "../../setup";
import { entryCategories, ledgerEntries, ledgers } from "@/persistence";
import { sourceDocuments } from "@/persistence/schema/source-document";
import { randomUUID } from "node:crypto";

import { getEntryCategoriesAction } from "@/modules/ledger/server/list-categories";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
} from "../../helpers/schema-setup";

async function getTargetEntryCategoriesAction(ledgerId: string) {
  const db = getTestDb();
  const documents = await db.query.sourceDocuments.findMany({
    where: (documents, { eq }) => eq(documents.ledgerId, ledgerId),
    columns: { id: true, deletedAt: true },
  });
  for (const document of documents) {
    if (document.deletedAt == null) {
      await activateTestSourceDocumentProjection(db, document.id);
    }
  }
  return getEntryCategoriesAction(ledgerId);
}

const TEST_USER_ID = "00000000-0000-0000-0000-000000000000";

describe("getEntryCategoriesAction", () => {
  let ledgerId: string;

  beforeEach(async () => {
    const db = getTestDb();
    ledgerId = randomUUID();
    await db.insert(ledgers).values({
      id: ledgerId,
      userId: TEST_USER_ID,
    });
    await ensureTestLedgerBooks(db, ledgerId);
  });

  it("returns categories sorted by sortOrder", async () => {
    const db = getTestDb();
    await db.insert(entryCategories).values([
      { id: randomUUID(), ledgerId, name: "B", sortOrder: 2 },
      { id: randomUUID(), ledgerId, name: "A", sortOrder: 1 },
      { id: randomUUID(), ledgerId, name: "C", sortOrder: 3 },
    ]);

    const result = await getTargetEntryCategoriesAction(ledgerId);
    expect(result.map((c) => c.name)).toEqual(["A", "B", "C"]);
  });

  it("excludes soft-deleted categories", async () => {
    const db = getTestDb();
    await db.insert(entryCategories).values([
      { id: randomUUID(), ledgerId, name: "Active", sortOrder: 1 },
      { id: randomUUID(), ledgerId, name: "Deleted", sortOrder: 2, deletedAt: new Date() },
    ]);

    const result = await getTargetEntryCategoriesAction(ledgerId);
    expect(result).toHaveLength(1);
    const firstCategory = result[0];
    expect(firstCategory).toBeDefined();
    expect(firstCategory?.name).toBe("Active");
  });

  it("includes entry count per category", async () => {
    const db = getTestDb();
    const catId = randomUUID();
    await db.insert(entryCategories).values({
      id: catId,
      ledgerId,
      name: "餐饮",
      sortOrder: 1,
    });

    const [doc] = await db
      .insert(sourceDocuments)
      .values({
        id: randomUUID(),
        ledgerId,
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    expect(doc).toBeDefined();
    if (doc === undefined) {
      throw new Error("Expected source document insert to return a row");
    }

    await db.insert(ledgerEntries).values([
      {
        id: randomUUID(),
        ledgerId,
        sourceDocumentId: doc.id,
        itemName: "Item 1",
        amount: "10.00",
        currency: "CNY",
        categoryId: catId,
      },
      {
        id: randomUUID(),
        ledgerId,
        sourceDocumentId: doc.id,
        itemName: "Item 2",
        amount: "20.00",
        currency: "CNY",
        categoryId: catId,
      },
    ]);

    const result = await getTargetEntryCategoriesAction(ledgerId);
    const firstCategory = result[0];
    expect(firstCategory).toBeDefined();
    expect(firstCategory?.entryCount).toBe(2);
  });

  it("excludes entries linked to deleted source documents from category counts", async () => {
    const db = getTestDb();
    const catId = randomUUID();
    await db.insert(entryCategories).values({
      id: catId,
      ledgerId,
      name: "交通",
      sortOrder: 2,
    });

    const [activeDoc] = await db
      .insert(sourceDocuments)
      .values({
        id: randomUUID(),
        ledgerId,
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    expect(activeDoc).toBeDefined();
    if (activeDoc === undefined) {
      throw new Error("Expected active source document insert to return a row");
    }

    const [deletedDoc] = await db
      .insert(sourceDocuments)
      .values({
        id: randomUUID(),
        ledgerId,
        deletedAt: new Date(),
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    expect(deletedDoc).toBeDefined();
    if (deletedDoc === undefined) {
      throw new Error("Expected deleted source document insert to return a row");
    }

    await db.insert(ledgerEntries).values([
      {
        id: randomUUID(),
        ledgerId,
        sourceDocumentId: activeDoc.id,
        itemName: "Active doc entry",
        amount: "10.00",
        currency: "CNY",
        categoryId: catId,
      },
      {
        id: randomUUID(),
        ledgerId,
        sourceDocumentId: deletedDoc.id,
        itemName: "Deleted doc entry",
        amount: "20.00",
        currency: "CNY",
        categoryId: catId,
      },
    ]);

    const result = await getTargetEntryCategoriesAction(ledgerId);
    const category = result.find((item) => item.id === catId);
    expect(category).toBeDefined();
    expect(category?.entryCount).toBe(1);
  });
});
