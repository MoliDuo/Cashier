import { sql } from "drizzle-orm";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getTestDb } from "../../setup";
import { entryCategories, ledgerEntries, ledgers, loginEmails, users } from "@/persistence";
import { sourceDocuments } from "@/persistence/schema/source-document";
import { v4 as uuidv4 } from "uuid";
import { eq } from "drizzle-orm";

import {
  createEntryCategoryAction,
  deleteEntryCategoryAction,
  reorderEntryCategoriesAction,
} from "@/modules/ledger/server-actions/categories";
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

describe("createEntryCategoryAction", () => {
  let ledgerId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = getTestDb();
    ledgerId = uuidv4();
    await db.insert(ledgers).values({
      id: ledgerId,
      userId: TEST_USER_ID,
    });
    await ensureTestLedgerBooks(db, ledgerId);
  });

  it("creates a category synchronously with user-provided/default metadata", async () => {
    const category = await createEntryCategoryAction(ledgerId, { name: "Travel" });
    expect(category.name).toBe("Travel");
    expect(category.icon ?? null).toBeNull();
    expect(category.description ?? null).toBeNull();
  });

  it("creates a category with all fields and no task run", async () => {
    const result = await createEntryCategoryAction(ledgerId, {
      name: "餐饮",
      description: "食物相关",
      icon: "🍽️",
    });

    expect(result.name).toBe("餐饮");
    expect(result.ledgerId).toBe(ledgerId);
    expect(result.id).toBeDefined();
    expect(result.icon).toBe("🍽️");
    expect(result.description).toBe("食物相关");
  });

  it("different ledgers can have same category name (tenant isolation)", async () => {
    const db = getTestDb();
    const ledgerId2 = uuidv4();
    const otherUserId = uuidv4();

    // Create another user first with unique email
    await db.insert(users).values({ id: otherUserId }).onConflictDoNothing();
    await db.insert(loginEmails).values({
      userId: otherUserId,
      email: `other-${uuidv4()}@example.com`,
      emailVerified: new Date(),
    });

    await db.insert(ledgers).values({
      id: ledgerId2,
      userId: otherUserId,
    });

    // Create categories for each ledger directly in DB (bypassing action auth checks)
    const catId1 = uuidv4();
    const catId2 = uuidv4();
    await db.insert(entryCategories).values({
      id: catId1,
      ledgerId,
      name: "餐饮",
      description: "食物",
      icon: "🍽️",
      sortOrder: 1,
    });
    await db.insert(entryCategories).values({
      id: catId2,
      ledgerId: ledgerId2,
      name: "餐饮",
      description: "食物",
      icon: "🍽️",
      sortOrder: 1,
    });

    // Verify categories exist and belong to correct ledgers
    const cat1 = await db.query.entryCategories.findFirst({
      where: eq(entryCategories.id, catId1),
    });
    const cat2 = await db.query.entryCategories.findFirst({
      where: eq(entryCategories.id, catId2),
    });

    expect(cat1?.id).not.toBe(cat2?.id);
    expect(cat1?.ledgerId).toBe(ledgerId);
    expect(cat2?.ledgerId).toBe(ledgerId2);
    expect(cat1?.name).toBe("餐饮");
    expect(cat2?.name).toBe("餐饮");
  });

  it("throws 'Ledger not found' for wrong ledger", async () => {
    await expect(
      createEntryCategoryAction(uuidv4(), { name: "Test", description: "d", icon: "x" })
    ).rejects.toThrow("Ledger not found");
  });
});

describe("deleteEntryCategoryAction", () => {
  let ledgerId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = getTestDb();
    ledgerId = uuidv4();
    await db.insert(ledgers).values({
      id: ledgerId,
      userId: TEST_USER_ID,
    });
    await ensureTestLedgerBooks(db, ledgerId);
  });

  it("soft-deletes the category", async () => {
    const db = getTestDb();
    const catId = uuidv4();
    await db.insert(entryCategories).values({
      id: catId,
      ledgerId,
      name: "餐饮",
      sortOrder: 1,
    });

    await deleteEntryCategoryAction(ledgerId, catId);

    const cat = await db.query.entryCategories.findFirst({
      where: eq(entryCategories.id, catId),
    });
    expect(cat?.deletedAt).not.toBeNull();
  });

  it("nullifies categoryId on associated entries", async () => {
    const db = getTestDb();
    const catId = uuidv4();
    await db.insert(entryCategories).values({
      id: catId,
      ledgerId,
      name: "餐饮",
      sortOrder: 1,
    });

    const [doc] = await db
      .insert(sourceDocuments)
      .values({
        id: uuidv4(),
        ledgerId,
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    expect(doc).toBeDefined();
    if (doc === undefined) {
      throw new Error("Expected source document insert to return a row");
    }

    const [entry] = await db
      .insert(ledgerEntries)
      .values({
        id: uuidv4(),
        ledgerId,
        sourceDocumentId: doc.id,
        itemName: "午餐",
        amount: "25.00",
        currency: "CNY",
        categoryId: catId,
      })
      .returning();
    expect(entry).toBeDefined();
    if (entry === undefined) {
      throw new Error("Expected ledger entry insert to return a row");
    }

    await deleteEntryCategoryAction(ledgerId, catId);

    const updatedEntry = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, entry.id),
    });
    expect(updatedEntry?.categoryId).toBeNull();
  });
});

describe("reorderEntryCategoriesAction", () => {
  let ledgerId: string;

  beforeEach(async () => {
    const db = getTestDb();
    ledgerId = uuidv4();
    await db.insert(ledgers).values({
      id: ledgerId,
      userId: TEST_USER_ID,
    });
    await ensureTestLedgerBooks(db, ledgerId);
  });

  it("updates sortOrder for each category", async () => {
    const db = getTestDb();
    const id1 = uuidv4();
    const id2 = uuidv4();
    const id3 = uuidv4();

    await db.insert(entryCategories).values([
      { id: id1, ledgerId, name: "A", sortOrder: 0 },
      { id: id2, ledgerId, name: "B", sortOrder: 1 },
      { id: id3, ledgerId, name: "C", sortOrder: 2 },
    ]);

    // Reorder: C, A, B
    await reorderEntryCategoriesAction(ledgerId, [id3, id1, id2]);

    const cats = await db.query.entryCategories.findMany({
      where: eq(entryCategories.ledgerId, ledgerId),
    });
    const byId = Object.fromEntries(cats.map((c) => [c.id, c.sortOrder]));
    expect(byId[id3]).toBe(0);
    expect(byId[id1]).toBe(1);
    expect(byId[id2]).toBe(2);
  });

  it("rejects a partial reorder set", async () => {
    const db = getTestDb();
    const id1 = uuidv4();
    const id2 = uuidv4();
    await db.insert(entryCategories).values([
      { id: id1, ledgerId, name: "A", sortOrder: 0 },
      { id: id2, ledgerId, name: "B", sortOrder: 1 },
    ]);

    await expect(reorderEntryCategoriesAction(ledgerId, [id1])).rejects.toThrow(
      /every active category/i
    );
  });
});

describe("getEntryCategoriesAction", () => {
  let ledgerId: string;

  beforeEach(async () => {
    const db = getTestDb();
    ledgerId = uuidv4();
    await db.insert(ledgers).values({
      id: ledgerId,
      userId: TEST_USER_ID,
    });
    await ensureTestLedgerBooks(db, ledgerId);
  });

  it("returns categories sorted by sortOrder", async () => {
    const db = getTestDb();
    await db.insert(entryCategories).values([
      { id: uuidv4(), ledgerId, name: "B", sortOrder: 2 },
      { id: uuidv4(), ledgerId, name: "A", sortOrder: 1 },
      { id: uuidv4(), ledgerId, name: "C", sortOrder: 3 },
    ]);

    const result = await getTargetEntryCategoriesAction(ledgerId);
    expect(result.map((c) => c.name)).toEqual(["A", "B", "C"]);
  });

  it("excludes soft-deleted categories", async () => {
    const db = getTestDb();
    await db.insert(entryCategories).values([
      { id: uuidv4(), ledgerId, name: "Active", sortOrder: 1 },
      { id: uuidv4(), ledgerId, name: "Deleted", sortOrder: 2, deletedAt: new Date() },
    ]);

    const result = await getTargetEntryCategoriesAction(ledgerId);
    expect(result).toHaveLength(1);
    const firstCategory = result[0];
    expect(firstCategory).toBeDefined();
    expect(firstCategory?.name).toBe("Active");
  });

  it("includes entry count per category", async () => {
    const db = getTestDb();
    const catId = uuidv4();
    await db.insert(entryCategories).values({
      id: catId,
      ledgerId,
      name: "餐饮",
      sortOrder: 1,
    });

    const [doc] = await db
      .insert(sourceDocuments)
      .values({
        id: uuidv4(),
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
        id: uuidv4(),
        ledgerId,
        sourceDocumentId: doc.id,
        itemName: "Item 1",
        amount: "10.00",
        currency: "CNY",
        categoryId: catId,
      },
      {
        id: uuidv4(),
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
    const catId = uuidv4();
    await db.insert(entryCategories).values({
      id: catId,
      ledgerId,
      name: "交通",
      sortOrder: 2,
    });

    const [activeDoc] = await db
      .insert(sourceDocuments)
      .values({
        id: uuidv4(),
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
        id: uuidv4(),
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
        id: uuidv4(),
        ledgerId,
        sourceDocumentId: activeDoc.id,
        itemName: "Active doc entry",
        amount: "10.00",
        currency: "CNY",
        categoryId: catId,
      },
      {
        id: uuidv4(),
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
