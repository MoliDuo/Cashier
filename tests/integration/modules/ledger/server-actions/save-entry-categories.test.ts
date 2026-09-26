import { saveSourceDocumentChangesAction } from "@/modules/source-document/server-actions/update";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getCurrentSession } from "@/modules/auth/server/current-session";
import { testSession } from "tests/helpers/session";
import { saveEntryCategoriesAction } from "@/modules/ledger/server-actions/categories";
import { saveEntryCategories } from "@/modules/ledger/server/categories";
import {
  entryCategories,
  ledgerEntries,
  ledgers,
  sourceDocuments,
  sourceDocumentRevisions,
} from "@/persistence";
import { getTestDb } from "tests/setup";
import { createLedgerData, createSourceDocumentData } from "tests/helpers/factories";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
} from "tests/helpers/schema-setup";
import { computeCategoryCollectionRevision } from "@/modules/ledger/category-collection-revision";

vi.mock("@/modules/auth/server/current-session", () => ({ getCurrentSession: vi.fn() }));

describe("saveEntryCategoriesAction", () => {
  const userId = "00000000-0000-0000-0000-000000000000";

  beforeEach(() => {
    vi.mocked(getCurrentSession).mockResolvedValue(
      testSession(userId, { email: "category-save@example.com" })
    );
  });

  it("commits additions, edits, deletions, and ordering in one transaction", async () => {
    const db = getTestDb();
    const ledger = createLedgerData();
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
    // Multiple affected entries must still advance their aggregate only once.
    await db.insert(ledgerEntries).values({
      id: crypto.randomUUID(),
      ledgerId: ledger.id,
      sourceDocumentId: document.id,
      itemName: "Second categorized item",
      amount: "5",
      currency: "CNY",
      categoryId: removeId,
    });
    await activateTestSourceDocumentProjection(db, document.id);
    const expectedRevision = await computeCategoryCollectionRevision(
      await db.query.entryCategories.findMany({
        where: eq(entryCategories.ledgerId, ledger.id),
      })
    );

    const saved = await saveEntryCategoriesAction({
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
    expect(removed).toBeUndefined();
    expect(entry?.categoryId).toBeNull();
    // Clearing a deleted category does not make an open draft stale.
    expect(
      await db.query.sourceDocuments.findFirst({ where: eq(sourceDocuments.id, document.id) })
    ).toMatchObject({ version: 1 });
    expect(
      await saveSourceDocumentChangesAction({
        sourceDocumentId: document.id,
        expectedVersion: 1,
        sourceDocument: { title: "Draft edit" },
        entries: [],
      })
    ).toMatchObject({ ok: true, version: 2 });
    await saveEntryCategoriesAction({
      expectedRevision: await computeCategoryCollectionRevision(saved),
      categories: saved.map(({ id, name, description, icon }) => ({ id, name, description, icon })),
    });
    expect(
      await db.query.sourceDocuments.findFirst({ where: eq(sourceDocuments.id, document.id) })
    ).toMatchObject({ version: 2 });
  });

  it("rolls back the whole category draft when an affected document is processing", async () => {
    const db = getTestDb();
    const ledger = createLedgerData();
    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db, ledger.id);
    const categoryId = crypto.randomUUID();
    await db.insert(entryCategories).values({ id: categoryId, ledgerId: ledger.id, name: "Busy" });
    const documents = [createSourceDocumentData(ledger.id), createSourceDocumentData(ledger.id)];
    for (const document of documents) {
      await db.insert(sourceDocuments).values({
        ...document,
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledger.id} ORDER BY sort_order LIMIT 1)`,
      });
      await db.insert(ledgerEntries).values({
        ledgerId: ledger.id,
        sourceDocumentId: document.id,
        categoryId,
        itemName: "Affected",
        amount: "10",
        currency: "CNY",
      });
      await activateTestSourceDocumentProjection(db, document.id);
      if (document === documents[1]) {
        const [attempt] = await db
          .insert(sourceDocumentRevisions)
          .values({
            ledgerId: ledger.id,
            sourceDocumentId: document.id,
            processingStatus: "processing",
          })
          .returning();
        await db
          .update(sourceDocuments)
          .set({ latestSubmissionRevisionId: attempt!.id })
          .where(eq(sourceDocuments.id, document.id));
      }
    }
    const categories = await db.query.entryCategories.findMany({
      where: eq(entryCategories.ledgerId, ledger.id),
    });
    await expect(
      saveEntryCategoriesAction({
        expectedRevision: await computeCategoryCollectionRevision(categories),
        categories: [],
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await db.query.entryCategories.findFirst({ where: eq(entryCategories.id, categoryId) })
    ).toBeDefined();
    const entries = await db.query.ledgerEntries.findMany({
      where: eq(ledgerEntries.ledgerId, ledger.id),
    });
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.categoryId === categoryId)).toBe(true);
    const unchanged = await db.query.sourceDocuments.findMany({
      where: eq(sourceDocuments.ledgerId, ledger.id),
    });
    expect(unchanged.every((document) => document.version === 1)).toBe(true);
  });

  it("requires authentication before saving a collection", async () => {
    vi.mocked(getCurrentSession).mockResolvedValueOnce(null);
    await expect(
      saveEntryCategoriesAction({
        expectedRevision: await computeCategoryCollectionRevision([]),
        categories: [],
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects categories belonging to another ledger without modifying either collection", async () => {
    const db = getTestDb();
    const ledger = createLedgerData();
    // Two ledgers never coexist in the app, so this drives the server function,
    // which still scopes every category it touches by the ledger it is given.
    const other = createLedgerData();
    await db.insert(ledgers).values([ledger, other]);
    const ownId = crypto.randomUUID();
    const foreignId = crypto.randomUUID();
    await db.insert(entryCategories).values([
      { id: ownId, ledgerId: ledger.id, name: "Own" },
      { id: foreignId, ledgerId: other.id, name: "Foreign" },
    ]);
    const current = await db.query.entryCategories.findMany({
      where: eq(entryCategories.ledgerId, ledger.id),
    });
    await expect(
      saveEntryCategories(ledger.id, {
        expectedRevision: await computeCategoryCollectionRevision(current),
        categories: [{ id: foreignId, name: "Overwrite", description: null, icon: null }],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(
      await db.query.entryCategories.findFirst({ where: eq(entryCategories.id, ownId) })
    ).toMatchObject({ name: "Own" });
    expect(
      await db.query.entryCategories.findFirst({ where: eq(entryCategories.id, foreignId) })
    ).toMatchObject({ name: "Foreign" });
  });

  it("allows every category to be edited and deleted", async () => {
    const db = getTestDb();
    const ledger = createLedgerData();
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
      saveEntryCategoriesAction({
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
      orderBy: entryCategories.sortOrder,
    });
    expect(active.map((category) => category.name)).toEqual(["Changed"]);
  });

  it("rejects a malformed collection before touching the categories", async () => {
    const db = getTestDb();
    const ledger = createLedgerData();
    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db, ledger.id);
    await db.insert(entryCategories).values({ ledgerId: ledger.id, name: "Kept", sortOrder: 0 });

    await expect(
      saveEntryCategoriesAction({ expectedRevision: "invalid", categories: [] } as never)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      db.query.entryCategories.findMany({ where: eq(entryCategories.ledgerId, ledger.id) })
    ).resolves.toEqual([expect.objectContaining({ name: "Kept" })]);
  });

  it("rejects a stale category collection revision without applying the draft", async () => {
    const db = getTestDb();
    const ledger = createLedgerData();
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
      saveEntryCategoriesAction({
        expectedRevision,
        categories: [{ id: categoryId, name: "Draft", description: null, icon: null }],
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      db.query.entryCategories.findFirst({ where: eq(entryCategories.id, categoryId) })
    ).resolves.toMatchObject({ name: "Changed elsewhere" });
  });

  it("swaps two names and reuses a deleted category's name in one save", async () => {
    const db = getTestDb();
    const ledger = createLedgerData();
    const [aId, bId, goneId] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db, ledger.id);
    await db.insert(entryCategories).values([
      { id: aId, ledgerId: ledger.id, name: "A", sortOrder: 0 },
      { id: bId, ledgerId: ledger.id, name: "B", sortOrder: 1 },
      { id: goneId, ledgerId: ledger.id, name: "Gone", sortOrder: 2 },
    ]);
    const expectedRevision = await computeCategoryCollectionRevision(
      await db.query.entryCategories.findMany({
        where: eq(entryCategories.ledgerId, ledger.id),
        orderBy: entryCategories.sortOrder,
      })
    );

    await saveEntryCategoriesAction({
      expectedRevision,
      categories: [
        { id: aId, name: "B", description: null, icon: null },
        { id: bId, name: "Gone", description: null, icon: null },
        { clientId: crypto.randomUUID(), name: "A", description: null, icon: null },
      ],
    });

    const rows = await db.query.entryCategories.findMany({
      where: eq(entryCategories.ledgerId, ledger.id),
      orderBy: entryCategories.sortOrder,
    });
    expect(
      rows.map((row) => [row.id === aId ? "a" : row.id === bId ? "b" : "new", row.name])
    ).toEqual([
      ["a", "B"],
      ["b", "Gone"],
      ["new", "A"],
    ]);
  });

  it("saves the maximum category batch while swapping every unique name", async () => {
    const db = getTestDb();
    const ledger = createLedgerData();
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

    const saved = await saveEntryCategoriesAction({
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
