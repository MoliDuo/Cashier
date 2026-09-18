import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, isNull } from "drizzle-orm";
import { auth } from "@/auth";
import { saveEntryCategoriesAction } from "@/modules/ledger/server-actions/categories";
import { entryCategories, ledgerEntries, ledgers, sourceDocuments } from "@/persistence";
import { getTestDb } from "../../setup";
import { createLedgerData, createSourceDocumentData } from "../../helpers/factories";
import { ensureTestLedgerBooks } from "../../helpers/schema-setup";
import { computeCategoryCollectionRevision } from "@/modules/ledger/category-collection-revision";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

describe("saveEntryCategoriesAction", () => {
  const userId = "00000000-0000-0000-0000-000000000000";

  beforeEach(() => {
    vi.mocked(
      auth as unknown as () => Promise<{
        user: { id: string; email: string };
        expires: string;
      } | null>
    ).mockResolvedValue({
      user: { id: userId, email: "category-save@example.com" },
      expires: new Date(Date.now() + 3_600_000).toISOString(),
    });
  });

  it("commits additions, edits, deletions, and ordering in one transaction", async () => {
    const db = getTestDb();
    const ledger = createLedgerData({ userId });
    const keepId = crypto.randomUUID();
    const removeId = crypto.randomUUID();
    const newId = crypto.randomUUID();
    const document = createSourceDocumentData(ledger.id);
    const entryId = crypto.randomUUID();

    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db, ledger.id);
    await db.insert(entryCategories).values([
      { id: keepId, ledgerId: ledger.id, name: "Keep", sortOrder: 0 },
      { id: removeId, ledgerId: ledger.id, name: "Remove", sortOrder: 1 },
    ]);
    await db.insert(sourceDocuments).values({
      ...document,
      bookId: sql`(SELECT id FROM books WHERE ledger_id = ${document.ledgerId} ORDER BY sort_order LIMIT 1)`,
    });
    await db.insert(ledgerEntries).values({
      id: entryId,
      ledgerId: ledger.id,
      sourceDocumentId: document.id,
      itemName: "Categorized",
      amount: "10.00",
      currency: "CNY",
      categoryId: removeId,
    });
    const expectedRevision = await computeCategoryCollectionRevision(
      await db.query.entryCategories.findMany({
        where: eq(entryCategories.ledgerId, ledger.id),
      })
    );

    const saved = await saveEntryCategoriesAction(ledger.id, {
      expectedRevision,
      categories: [
        {
          clientId: newId,
          name: "New",
          description: "Created in draft",
          icon: "circle",
        },
        {
          id: keepId,
          name: "Renamed",
          description: null,
          icon: null,
        },
      ],
    });

    expect(saved.map((category) => category.id)).toEqual([newId, keepId]);
    expect(saved.map((category) => category.sortOrder)).toEqual([0, 1]);
    expect(saved[1]?.name).toBe("Renamed");
    const removed = await db.query.entryCategories.findFirst({
      where: eq(entryCategories.id, removeId),
    });
    const entry = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, entryId),
    });
    expect(removed?.deletedAt).not.toBeNull();
    expect(entry?.categoryId).toBeNull();
  });

  it("allows every category to be edited and deleted", async () => {
    const db = getTestDb();
    const ledger = createLedgerData({ userId });
    const editableId = crypto.randomUUID();
    const fixedId = crypto.randomUUID();
    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db, ledger.id);
    await db.insert(entryCategories).values([
      { id: editableId, ledgerId: ledger.id, name: "Editable", sortOrder: 0 },
      {
        id: fixedId,
        ledgerId: ledger.id,
        name: "Fixed",
        sortOrder: 1,
      },
    ]);
    const expectedRevision = await computeCategoryCollectionRevision(
      await db.query.entryCategories.findMany({
        where: eq(entryCategories.ledgerId, ledger.id),
      })
    );

    await expect(
      saveEntryCategoriesAction(ledger.id, {
        expectedRevision,
        categories: [
          {
            id: editableId,
            name: "Changed",
            description: null,
            icon: null,
          },
        ],
      })
    ).resolves.toHaveLength(1);

    const active = await db.query.entryCategories.findMany({
      where: isNull(entryCategories.deletedAt),
      orderBy: entryCategories.sortOrder,
    });
    expect(active.map((category) => category.name)).toEqual(["Changed"]);
  });

  it("rejects a stale category collection revision without applying the draft", async () => {
    const db = getTestDb();
    const ledger = createLedgerData({ userId });
    const categoryId = crypto.randomUUID();
    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db, ledger.id);
    await db.insert(entryCategories).values({
      id: categoryId,
      ledgerId: ledger.id,
      name: "Original",
      sortOrder: 0,
    });
    const expectedRevision = await computeCategoryCollectionRevision(
      await db.query.entryCategories.findMany({
        where: eq(entryCategories.ledgerId, ledger.id),
      })
    );
    await db
      .update(entryCategories)
      .set({ name: "Changed elsewhere", updatedAt: new Date() })
      .where(eq(entryCategories.id, categoryId));

    await expect(
      saveEntryCategoriesAction(ledger.id, {
        expectedRevision,
        categories: [{ id: categoryId, name: "Draft", description: null, icon: null }],
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      db.query.entryCategories.findFirst({ where: eq(entryCategories.id, categoryId) })
    ).resolves.toMatchObject({ name: "Changed elsewhere" });
  });

  it("saves the maximum category batch while swapping every unique name", async () => {
    const db = getTestDb();
    const ledger = createLedgerData({ userId });
    const categories = Array.from({ length: 100 }, (_, index) => ({
      id: crypto.randomUUID(),
      ledgerId: ledger.id,
      name: `Category ${index}`,
      sortOrder: index,
    }));
    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db, ledger.id);
    await db.insert(entryCategories).values(categories);
    const expectedRevision = await computeCategoryCollectionRevision(
      await db.query.entryCategories.findMany({
        where: eq(entryCategories.ledgerId, ledger.id),
        orderBy: entryCategories.sortOrder,
      })
    );

    const saved = await saveEntryCategoriesAction(ledger.id, {
      expectedRevision,
      categories: categories.map((category, index) => ({
        id: category.id,
        name: `Category ${(index + 1) % categories.length}`,
        description: `Position ${index}`,
        icon: null,
      })),
    });

    expect(saved).toHaveLength(100);
    expect(saved.map((category) => category.name)).toEqual(
      Array.from({ length: 100 }, (_, index) => `Category ${(index + 1) % 100}`)
    );
    expect(saved.map((category) => category.sortOrder)).toEqual(
      Array.from({ length: 100 }, (_, index) => index)
    );
  });
});
