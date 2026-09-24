import { sql } from "drizzle-orm";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getTestDb } from "../../setup";
import { ledgers, ledgerEntries, entryCategories } from "@/persistence";
import { sourceDocuments } from "@/persistence/schema/source-document";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";

const { getRatesMock, convertBatchMock } = vi.hoisted(() => ({
  getRatesMock: vi.fn(async () => ({
    base: "USD",
    date: "2026-01-01",
    rates: { CNY: 1 } as Record<string, number>,
  })),
  convertBatchMock: vi.fn(),
}));

vi.mock("@/application/adapters/postgres/exchange-rate", () => {
  const rateBook = {
    getRates: getRatesMock,
    convertBatch: convertBatchMock,
  };
  return { ExchangeRateService: rateBook, postgresFxRateBook: rateBook, fetchWithRetry: vi.fn() };
});
import {
  batchUpdateLedgerEntriesAction,
  batchUpdateLedgerEntryDatesAction,
  previewBatchLedgerEntryDateAction,
} from "@/modules/ledger/server-actions/entries";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
} from "../../helpers/schema-setup";

const TEST_USER_ID = "00000000-0000-0000-0000-000000000000";

async function seedDoc(db: ReturnType<typeof getTestDb>, ledgerId: string, entryDate?: string) {
  const [doc] = await db
    .insert(sourceDocuments)
    .values({
      id: randomUUID(),
      ledgerId,
      documentDate: entryDate ?? null,
      bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
    })
    .returning();
  expect(doc).toBeDefined();
  if (doc === undefined) {
    throw new Error("Expected source document insert to return a row");
  }
  await activateTestSourceDocumentProjection(db, doc.id);
  return doc;
}

describe("batchUpdateLedgerEntriesAction", () => {
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

  it("batch updates categoryId for multiple entries", async () => {
    const db = getTestDb();
    const catId = randomUUID();
    await db.insert(entryCategories).values({
      id: catId,
      ledgerId,
      name: "餐饮",
      sortOrder: 1,
    });

    const doc = await seedDoc(db, ledgerId);
    const ids: string[] = [];

    for (let i = 0; i < 2; i++) {
      const [e] = await db
        .insert(ledgerEntries)
        .values({
          id: randomUUID(),
          ledgerId,
          sourceDocumentId: doc.id,
          itemName: `Item ${i}`,
          amount: "10.00",
          currency: "CNY",
        })
        .returning();
      expect(e).toBeDefined();
      if (e === undefined) {
        throw new Error("Expected ledger entry insert to return a row");
      }
      ids.push(e.id);
    }
    await activateTestSourceDocumentProjection(db, doc.id);

    const before = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, doc.id),
    });
    await batchUpdateLedgerEntriesAction(
      [{ sourceDocumentId: doc.id, expectedVersion: before!.version }],
      ids,
      { categoryId: catId }
    );
    const after = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, doc.id),
    });

    // Manual edits update the active projection in place and bump the version.
    expect(after?.activeRevisionId).toBe(before?.activeRevisionId);
    expect(after?.version).toBe(before!.version + 1);

    for (const id of ids) {
      const entry = await db.query.ledgerEntries.findFirst({
        where: eq(ledgerEntries.id, id),
      });
      expect(entry?.categoryId).toBe(catId);
    }
  });

  it("removes categories from entries when given categoryId null", async () => {
    const db = getTestDb();
    const catId = randomUUID();
    await db.insert(entryCategories).values({
      id: catId,
      ledgerId,
      name: "餐饮",
      sortOrder: 1,
    });

    const doc = await seedDoc(db, ledgerId);
    const ids: string[] = [];

    for (let i = 0; i < 2; i++) {
      const [e] = await db
        .insert(ledgerEntries)
        .values({
          id: randomUUID(),
          ledgerId,
          sourceDocumentId: doc.id,
          itemName: `Item ${i}`,
          amount: "10.00",
          currency: "CNY",
          categoryId: catId,
        })
        .returning();
      expect(e).toBeDefined();
      if (e === undefined) {
        throw new Error("Expected ledger entry insert to return a row");
      }
      ids.push(e.id);
    }
    await activateTestSourceDocumentProjection(db, doc.id);

    await batchUpdateLedgerEntriesAction([{ sourceDocumentId: doc.id, expectedVersion: 1 }], ids, {
      categoryId: null,
    });

    for (const id of ids) {
      const entry = await db.query.ledgerEntries.findFirst({
        where: eq(ledgerEntries.id, id),
      });
      expect(entry?.categoryId).toBeNull();
    }
  });

  it("uses one batch conversion for many amount updates", async () => {
    const db = getTestDb();
    const doc = await seedDoc(db, ledgerId, "2026-09-01");
    const ids = (
      await db
        .insert(ledgerEntries)
        .values(
          Array.from({ length: 20 }, (_, index) => ({
            id: randomUUID(),
            ledgerId,
            sourceDocumentId: doc.id,
            itemName: `Converted ${index}`,
            amount: "10.00",
            currency: "USD",
          }))
        )
        .returning({ id: ledgerEntries.id })
    ).map((entry) => entry.id);
    await activateTestSourceDocumentProjection(db, doc.id);
    convertBatchMock.mockImplementation(async (items: Array<{ amount: string }>) =>
      items.map((item) => ({ convertedAmount: item.amount, exchangeRate: "1" }))
    );

    await batchUpdateLedgerEntriesAction([{ sourceDocumentId: doc.id, expectedVersion: 1 }], ids, {
      amount: "12.00",
    });

    expect(convertBatchMock).toHaveBeenCalledTimes(1);
    expect(convertBatchMock.mock.calls[0]?.[0]).toHaveLength(20);
    expect(getRatesMock).not.toHaveBeenCalled();
  });

  it("rolls back the entire atomic batch when one target is stale", async () => {
    const db = getTestDb();
    const categoryId = randomUUID();
    await db.insert(entryCategories).values({
      id: categoryId,
      ledgerId,
      name: "Dining",
      sortOrder: 1,
    });
    const documents = await Promise.all([seedDoc(db, ledgerId), seedDoc(db, ledgerId)]);
    const entries = await Promise.all(
      documents.map(async (document, index) => {
        const [created] = await db
          .insert(ledgerEntries)
          .values({
            id: randomUUID(),
            ledgerId,
            sourceDocumentId: document.id,
            itemName: `Atomic ${index}`,
            amount: "10.00",
            currency: "CNY",
          })
          .returning();
        await activateTestSourceDocumentProjection(db, document.id);
        return created!;
      })
    );
    await db
      .update(sourceDocuments)
      .set({ version: 2 })
      .where(eq(sourceDocuments.id, documents[1]!.id));
    const before = await db.query.sourceDocuments.findMany({
      where: inArray(
        sourceDocuments.id,
        documents.map((document) => document.id)
      ),
    });

    const result = await batchUpdateLedgerEntriesAction(
      documents.map((document) => ({ sourceDocumentId: document.id, expectedVersion: 1 })),
      entries.map((entry) => entry.id),
      { categoryId }
    );

    expect(result).toEqual({
      ok: false,
      reason: "stale",
      staleTargets: [
        {
          sourceDocumentId: documents[1]!.id,
          expectedVersion: 1,
          currentVersion: 2,
        },
      ],
    });
    const afterEntries = await db.query.ledgerEntries.findMany({
      where: inArray(
        ledgerEntries.id,
        entries.map((entry) => entry.id)
      ),
    });
    expect(afterEntries.every((entry) => entry.categoryId == null)).toBe(true);
    const after = await db.query.sourceDocuments.findMany({
      where: inArray(
        sourceDocuments.id,
        documents.map((document) => document.id)
      ),
    });
    expect(
      after.map((document) => ({
        id: document.id,
        activeRevisionId: document.activeRevisionId,
        version: document.version,
        updatedAt: document.updatedAt,
      }))
    ).toEqual(
      before.map((document) => ({
        id: document.id,
        activeRevisionId: document.activeRevisionId,
        version: document.version,
        updatedAt: document.updatedAt,
      }))
    );
  });

  it("commits the date change and returns the locked impact", async () => {
    const db = getTestDb();
    convertBatchMock.mockResolvedValue([
      { convertedAmount: "10", exchangeRate: "1" },
      { convertedAmount: "20", exchangeRate: "1" },
    ]);
    const doc = await seedDoc(db, ledgerId, "2026-01-01");
    const ids = (
      await db
        .insert(ledgerEntries)
        .values([
          {
            id: randomUUID(),
            ledgerId,
            sourceDocumentId: doc.id,
            itemName: "First",
            amount: "10",
            currency: "CNY",
          },
          {
            id: randomUUID(),
            ledgerId,
            sourceDocumentId: doc.id,
            itemName: "Second",
            amount: "20",
            currency: "CNY",
          },
        ])
        .returning({ id: ledgerEntries.id })
    ).map((entry) => entry.id);
    const activeRevisionId = await activateTestSourceDocumentProjection(db, doc.id);
    const preview = await previewBatchLedgerEntryDateAction([ids[0]!]);

    const committed = await batchUpdateLedgerEntryDatesAction(
      [{ sourceDocumentId: doc.id, expectedVersion: 1 }],
      [ids[0]!],
      "2026-01-02"
    );

    expect(committed).toMatchObject({ ok: true });
    if (!committed.ok) throw new Error("Expected date update to succeed");
    expect(committed.data.impact).toEqual(preview);
    expect(committed.data.impact).toMatchObject({
      selectedEntryCount: 1,
      sourceDocumentCount: 1,
      affectedEntryCount: 2,
      sourceDocumentIds: [doc.id],
    });
    const updatedDocument = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, doc.id),
    });
    expect(updatedDocument?.documentDate).toBe("2026-01-02");
    expect(updatedDocument?.activeRevisionId).toBe(activeRevisionId);
    expect(updatedDocument?.version).toBe(2);
  });
});
