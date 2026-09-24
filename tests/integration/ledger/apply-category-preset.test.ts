import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/auth";
import { applyCategoryPresetAction } from "@/modules/ledger/server-actions/categories";
import { applyCategoryPreset } from "@/modules/ledger/server/categories";
import {
  entryCategories,
  ledgerEntries,
  ledgerSyncState,
  ledgers,
  sourceDocuments,
} from "@/persistence";
import { getTestDb } from "../../setup";
import { createLedgerData, createSourceDocumentData } from "../../helpers/factories";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
} from "../../helpers/schema-setup";
import { computeCategoryCollectionRevision } from "@/modules/ledger/category-collection-revision";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

const userId = "00000000-0000-0000-0000-000000000000";

async function activeCategories(ledgerId: string) {
  const db = getTestDb();
  return db.query.entryCategories.findMany({
    where: and(eq(entryCategories.ledgerId, ledgerId), isNull(entryCategories.deletedAt)),
    orderBy: entryCategories.sortOrder,
  });
}

async function revisionOf(ledgerId: string) {
  const db = getTestDb();
  return computeCategoryCollectionRevision(
    await db.query.entryCategories.findMany({
      where: and(eq(entryCategories.ledgerId, ledgerId), isNull(entryCategories.deletedAt)),
      orderBy: entryCategories.sortOrder,
    })
  );
}

describe("applyCategoryPresetAction", () => {
  beforeEach(() => {
    vi.mocked(
      auth as unknown as () => Promise<{
        user: { id: string; email: string };
        expires: string;
      } | null>
    ).mockResolvedValue({
      user: { id: userId, email: "preset@example.com" },
      expires: new Date(Date.now() + 3_600_000).toISOString(),
    });
  });

  it("moves entries instead of unsetting them and keeps a kept category", async () => {
    const db = getTestDb();
    const ledger = createLedgerData({ userId });
    const foodId = crypto.randomUUID();
    const travelId = crypto.randomUUID();
    const customId = crypto.randomUUID();
    const document = createSourceDocumentData(ledger.id);
    const foodEntryId = crypto.randomUUID();
    const travelEntryId = crypto.randomUUID();

    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db, ledger.id);
    await db.insert(entryCategories).values([
      { id: foodId, ledgerId: ledger.id, name: "餐饮", sortOrder: 0 },
      { id: travelId, ledgerId: ledger.id, name: "交通", sortOrder: 1 },
      { id: customId, ledgerId: ledger.id, name: "自定义", sortOrder: 2 },
    ]);
    await db.insert(sourceDocuments).values({
      ...document,
      bookId: sql`(SELECT id FROM books WHERE ledger_id = ${document.ledgerId} ORDER BY sort_order LIMIT 1)`,
    });
    const revisionId = await activateTestSourceDocumentProjection(db, document.id);
    await db.insert(ledgerEntries).values([
      {
        id: foodEntryId,
        ledgerId: ledger.id,
        sourceDocumentId: document.id,
        sourceDocumentRevisionId: revisionId,
        position: 0,
        itemName: "Lunch",
        amount: "30.00",
        currency: "CNY",
        categoryId: foodId,
      },
      {
        id: travelEntryId,
        ledgerId: ledger.id,
        sourceDocumentId: document.id,
        sourceDocumentRevisionId: revisionId,
        position: 1,
        itemName: "Metro",
        amount: "6.00",
        currency: "CNY",
        categoryId: travelId,
      },
    ]);

    const saved = await applyCategoryPresetAction({
      expectedRevision: await revisionOf(ledger.id),
      presetId: "concise",
      mappings: [
        { fromCategoryId: foodId, toPresetIndex: 0 },
        { fromCategoryId: travelId, toPresetIndex: 2 },
        { fromCategoryId: customId, toPresetIndex: null },
      ],
    });

    // Six preset categories plus the kept one.
    expect(saved.categories.map((category) => category.name)).toEqual([
      "吃喝",
      "居家",
      "出行",
      "健康",
      "娱乐",
      "其他",
      "自定义",
    ]);
    expect(saved.categories.map((category) => category.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6]);

    const food = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, foodEntryId),
    });
    const travel = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, travelEntryId),
    });
    const active = await activeCategories(ledger.id);
    expect(active.find((category) => category.name === "吃喝")?.id).toBe(food?.categoryId);
    expect(active.find((category) => category.name === "出行")?.id).toBe(travel?.categoryId);
    // Nothing was left uncategorized by the switch.
    expect(food?.categoryId).not.toBeNull();
    expect(travel?.categoryId).not.toBeNull();
    expect(active.find((category) => category.name === "自定义")?.id).toBe(customId);
  });

  it("reuses a kept row when a preset category shares its name", async () => {
    const db = getTestDb();
    const ledger = createLedgerData({ userId });
    const otherId = crypto.randomUUID();
    const foodId = crypto.randomUUID();

    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db, ledger.id);
    await db.insert(entryCategories).values([
      {
        id: otherId,
        ledgerId: ledger.id,
        name: "其他",
        description: "用户自己的其他",
        icon: "Star",
        sortOrder: 0,
      },
      { id: foodId, ledgerId: ledger.id, name: "餐饮", sortOrder: 1 },
    ]);

    const saved = await applyCategoryPresetAction({
      expectedRevision: await revisionOf(ledger.id),
      presetId: "concise",
      mappings: [
        { fromCategoryId: otherId, toPresetIndex: null },
        { fromCategoryId: foodId, toPresetIndex: 0 },
      ],
    });

    const others = saved.categories.filter((category) => category.name === "其他");
    expect(others).toHaveLength(1);
    // The user's own row survives, metadata included.
    expect(others[0]?.id).toBe(otherId);
    expect(others[0]?.description).toBe("用户自己的其他");
    expect(others[0]?.icon).toBe("Star");
  });

  it("rejects a stale category collection revision without writing", async () => {
    const db = getTestDb();
    const ledger = createLedgerData({ userId });
    const categoryId = crypto.randomUUID();
    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db, ledger.id);
    await db.insert(entryCategories).values({
      id: categoryId,
      ledgerId: ledger.id,
      name: "餐饮",
      sortOrder: 0,
    });
    const expectedRevision = await revisionOf(ledger.id);
    await db
      .update(entryCategories)
      .set({ name: "改过了", updatedAt: new Date() })
      .where(eq(entryCategories.id, categoryId));

    await expect(
      applyCategoryPresetAction({
        expectedRevision,
        presetId: "concise",
        mappings: [{ fromCategoryId: categoryId, toPresetIndex: 0 }],
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await activeCategories(ledger.id)).map((category) => category.name)).toEqual([
      "改过了",
    ]);
  });

  it("rejects a mapping that does not account for every active category", async () => {
    const db = getTestDb();
    const ledger = createLedgerData({ userId });
    const categoryId = crypto.randomUUID();
    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db, ledger.id);
    await db.insert(entryCategories).values([
      { id: categoryId, ledgerId: ledger.id, name: "餐饮", sortOrder: 0 },
      { id: crypto.randomUUID(), ledgerId: ledger.id, name: "交通", sortOrder: 1 },
    ]);

    await expect(
      applyCategoryPreset(ledger.id, {
        expectedRevision: await revisionOf(ledger.id),
        presetId: "concise",
        mappings: [{ fromCategoryId: categoryId, toPresetIndex: 0 }],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a category that belongs to another ledger", async () => {
    const db = getTestDb();
    const ledger = createLedgerData({ userId });
    // The app never holds two ledgers, so the action's gate would refuse this
    // database outright. The server function still scopes every category
    // lookup by the ledger it is given, which is what this pins.
    const otherLedger = createLedgerData({ userId });
    const foreignId = crypto.randomUUID();
    await db.insert(ledgers).values([ledger, otherLedger]);
    await ensureTestLedgerBooks(db, ledger.id);
    await ensureTestLedgerBooks(db, otherLedger.id);
    await db.insert(entryCategories).values([
      { id: crypto.randomUUID(), ledgerId: ledger.id, name: "餐饮", sortOrder: 0 },
      { id: foreignId, ledgerId: otherLedger.id, name: "别人的", sortOrder: 0 },
    ]);

    await expect(
      applyCategoryPreset(ledger.id, {
        expectedRevision: await revisionOf(ledger.id),
        presetId: "concise",
        mappings: [{ fromCategoryId: foreignId, toPresetIndex: 0 }],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await activeCategories(ledger.id)).map((category) => category.name)).toEqual(["餐饮"]);
  });

  it("advances the ledger sync version and flags categories and stats", async () => {
    const db = getTestDb();
    const ledger = createLedgerData({ userId });
    const categoryId = crypto.randomUUID();
    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db, ledger.id);
    await db.insert(entryCategories).values({
      id: categoryId,
      ledgerId: ledger.id,
      name: "餐饮",
      sortOrder: 0,
    });
    const before = await db.query.ledgerSyncState.findFirst({
      where: eq(ledgerSyncState.ledgerId, ledger.id),
    });

    await applyCategoryPresetAction({
      expectedRevision: await revisionOf(ledger.id),
      presetId: "concise",
      mappings: [{ fromCategoryId: categoryId, toPresetIndex: 0 }],
    });

    const after = await db.query.ledgerSyncState.findFirst({
      where: eq(ledgerSyncState.ledgerId, ledger.id),
    });
    expect(after?.version).toBe((before?.version ?? BigInt(0)) + BigInt(1));

    expect(after).toMatchObject({
      categoriesVersion: after!.version,
      statsVersion: after!.version,
    });
  });
});
