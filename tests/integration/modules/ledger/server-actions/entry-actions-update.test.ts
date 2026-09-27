import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { batchUpdateLedgerEntriesAction } from "@/modules/ledger/server-actions/entries";
import { ValidationError } from "@/lib/errors";
import { entryCategories, ledgerEntries, ledgers, sourceDocuments } from "@/persistence";
import * as exchangeRates from "@/modules/currency/server/exchange-rates";
import { getTestDb } from "tests/setup";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
} from "tests/helpers/schema-setup";
import { createCategoryData } from "tests/helpers/factories";

/** A single-entry edit is a one-entry batch: the UI has no other update path. */
function updateEntry(
  sourceDocumentId: string,
  entryId: string,
  data: Parameters<typeof batchUpdateLedgerEntriesAction>[2]
) {
  return batchUpdateLedgerEntriesAction([sourceDocumentId], [entryId], data);
}

describe("single-entry update", () => {
  let ledgerId: string;
  let sourceDocumentId: string;
  let entryId: string;

  beforeEach(async () => {
    const db = getTestDb();
    ledgerId = crypto.randomUUID();
    sourceDocumentId = crypto.randomUUID();
    entryId = crypto.randomUUID();
    await db.insert(ledgers).values({ id: ledgerId, mainCurrency: "CNY" });
    await ensureTestLedgerBooks(db, ledgerId);
    await db.insert(sourceDocuments).values({
      id: sourceDocumentId,
      ledgerId,
      bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
    });
    await db.insert(ledgerEntries).values({
      id: entryId,
      ledgerId,
      sourceDocumentId,
      itemName: "Lunch",
      amount: "50.000",
      currency: "CNY",
    });
    await activateTestSourceDocumentProjection(db, sourceDocumentId);
  });

  it("preserves the entry ID and increments the document exactly once", async () => {
    const result = await updateEntry(sourceDocumentId, entryId, {
      itemName: "Dinner",
    });
    expect(result).toEqual({ ledgerEntryIds: [entryId], affectedCount: 1 });
    const entry = await getTestDb().query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, entryId),
    });
    expect(entry?.itemName).toBe("Dinner");
    const document = await getTestDb().query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, sourceDocumentId),
    });
    expect(document?.version).toBe(2);
  });

  it("does not write or increment for a no-op", async () => {
    const result = await updateEntry(sourceDocumentId, entryId, {
      itemName: "Lunch",
    });
    expect(result).toEqual({ ledgerEntryIds: [entryId], affectedCount: 0 });
    const document = await getTestDb().query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, sourceDocumentId),
    });
    expect(document?.version).toBe(1);
  });

  it.each(["50", "50.00", "50.000"])(
    "treats numerically equivalent amount %s as a no-op",
    async (amount) => {
      await expect(updateEntry(sourceDocumentId, entryId, { amount })).resolves.toEqual({
        ledgerEntryIds: [entryId],
        affectedCount: 0,
      });
      const document = await getTestDb().query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, sourceDocumentId),
      });
      expect(document?.version).toBe(1);
    }
  );

  it("keeps a category another writer set while the edit was in flight", async () => {
    const db = getTestDb();
    const category = createCategoryData(ledgerId, { name: "Meals", sortOrder: 0 });
    await db.insert(entryCategories).values(category);
    // A category assignment commits between the edit's rate lookup and its
    // write, without advancing the document version.
    const ensure = vi.spyOn(exchangeRates, "ensureExchangeRates").mockImplementation(async () => {
      await db
        .update(ledgerEntries)
        .set({ categoryId: category.id })
        .where(eq(ledgerEntries.id, entryId));
    });

    try {
      await expect(updateEntry(sourceDocumentId, entryId, { currency: "EUR" })).resolves.toEqual({
        ledgerEntryIds: [entryId],
        affectedCount: 1,
      });
      expect(ensure).toHaveBeenCalledOnce();
    } finally {
      ensure.mockRestore();
    }
    expect(
      await db.query.ledgerEntries.findFirst({ where: eq(ledgerEntries.id, entryId) })
    ).toMatchObject({ currency: "EUR", categoryId: category.id });
  });

  it("asks for the document day's rate when only a foreign amount changes", async () => {
    const db = getTestDb();
    await db
      .update(ledgerEntries)
      .set({ currency: "USD", amount: "10.00" })
      .where(eq(ledgerEntries.id, entryId));
    const document = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, sourceDocumentId),
    });
    const ensure = vi.spyOn(exchangeRates, "ensureExchangeRates").mockResolvedValue(undefined);

    try {
      await updateEntry(sourceDocumentId, entryId, { amount: "12" });
      expect(ensure).toHaveBeenCalledWith([document?.effectiveDate]);
    } finally {
      ensure.mockRestore();
    }
  });

  it("does not ask for a rate when a main-currency amount changes", async () => {
    const ensure = vi.spyOn(exchangeRates, "ensureExchangeRates").mockResolvedValue(undefined);

    try {
      await updateEntry(sourceDocumentId, entryId, { amount: "12" });
      expect(ensure).not.toHaveBeenCalled();
    } finally {
      ensure.mockRestore();
    }
  });

  it("edits a deduction while preserving its negative direction", async () => {
    await getTestDb()
      .update(ledgerEntries)
      .set({ amount: "-8.000" })
      .where(eq(ledgerEntries.id, entryId));

    await expect(
      updateEntry(sourceDocumentId, entryId, {
        amount: "-6",
      })
    ).resolves.toEqual({ ledgerEntryIds: [entryId], affectedCount: 1 });

    const entry = await getTestDb().query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, entryId),
    });
    expect(entry).toMatchObject({ amount: "-6.000" });

    await expect(
      updateEntry(sourceDocumentId, entryId, {
        amount: "6",
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("updates the entry even after the document version moved on", async () => {
    await getTestDb()
      .update(sourceDocuments)
      .set({ version: 2 })
      .where(eq(sourceDocuments.id, sourceDocumentId));
    await expect(
      updateEntry(sourceDocumentId, entryId, {
        itemName: "Dinner",
      })
    ).resolves.toEqual({ ledgerEntryIds: [entryId], affectedCount: 1 });
    const [entry, document] = await Promise.all([
      getTestDb().query.ledgerEntries.findFirst({ where: eq(ledgerEntries.id, entryId) }),
      getTestDb().query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, sourceDocumentId),
      }),
    ]);
    expect(entry?.itemName).toBe("Dinner");
    expect(document?.version).toBe(3);
  });

  it("serializes two synchronized commands so both edits land", async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = barrier.then(() =>
      updateEntry(sourceDocumentId, entryId, {
        itemName: "Dinner",
      })
    );
    const second = barrier.then(() =>
      updateEntry(sourceDocumentId, entryId, {
        description: "Team meal",
      })
    );

    release();
    const results = await Promise.all([first, second]);
    expect(results).toEqual([
      { ledgerEntryIds: [entryId], affectedCount: 1 },
      { ledgerEntryIds: [entryId], affectedCount: 1 },
    ]);

    const [entry, document] = await Promise.all([
      getTestDb().query.ledgerEntries.findFirst({ where: eq(ledgerEntries.id, entryId) }),
      getTestDb().query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, sourceDocumentId),
      }),
    ]);
    expect(document?.version).toBe(3);
    expect(entry).toMatchObject({ itemName: "Dinner", description: "Team meal" });
  });
});
