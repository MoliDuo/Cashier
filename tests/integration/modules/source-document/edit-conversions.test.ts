import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestUserWithLedger } from "tests/helpers/schema-setup";
import { postgresSourceDocumentAggregateAdapter as aggregate } from "@/application/adapters/postgres/source-document-aggregate";
import { postgresFxRateBook } from "@/application/adapters/postgres/exchange-rate";
import { ledgerEntries, sourceDocuments } from "@/persistence";

afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const db = getTestDb();
  const { ledgerId, userId } = await createTestUserWithLedger(db);
  const created = await aggregate.createManualDocument({
    ledgerId,
    attributedUserId: userId,
    createdByUserId: userId,
    expectedMainCurrency: "CNY",
    title: "Original",
    entryDate: "2026-01-01",
    entries: ["One", "Two"].map((itemName) => ({
      categoryId: null,
      amount: "10",
      currency: "USD",
      itemName,
      description: null,
      convertedAmount: "70",
      exchangeRate: "7",
    })),
  });
  const entries = await db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.sourceDocumentRevisionId, created.revisionId));
  return { db, ledgerId, ...created, entries };
}

describe("document edit conversion scope", () => {
  it("preserves stored conversions for title and entry metadata changes", async () => {
    const { db, ledgerId, sourceDocumentId, entries } = await fixture();
    await db
      .update(ledgerEntries)
      .set({ amount: "10.001" })
      .where(eq(ledgerEntries.id, entries[0]!.id));
    const convert = vi
      .spyOn(postgresFxRateBook, "convertBatch")
      .mockRejectedValue(new Error("FX must not be called"));
    const result = await aggregate.saveChanges({
      ledgerId,
      sourceDocumentId,
      expectedVersion: 1,
      sourceDocument: { title: "Renamed" },
      entries: [{ ledgerEntryId: entries[0]!.id, data: { description: "Note" } }],
    });
    expect(result).toMatchObject({ ok: true, version: 2 });
    expect(convert).not.toHaveBeenCalled();
    const entry = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, entries[0]!.id),
    });
    expect(entry).toMatchObject({
      amount: "10.001",
      description: "Note",
      convertedAmount: entries[0]!.convertedAmount,
      exchangeRate: entries[0]!.exchangeRate,
    });
  });

  it("converts only the entry with changed financial values", async () => {
    const { db, ledgerId, sourceDocumentId, entries } = await fixture();
    const convert = vi
      .spyOn(postgresFxRateBook, "convertBatch")
      .mockResolvedValue([{ convertedAmount: "140", exchangeRate: "7" }]);
    await aggregate.saveChanges({
      ledgerId,
      sourceDocumentId,
      expectedVersion: 1,
      entries: [
        { ledgerEntryId: entries[0]!.id, data: { amount: "20" } },
        { ledgerEntryId: entries[1]!.id, data: { itemName: "Renamed" } },
      ],
    });
    expect(convert).toHaveBeenCalledExactlyOnceWith(
      [{ amount: "20.00", from: "USD", date: "2026-01-01" }],
      "CNY"
    );
    expect(
      await db.query.ledgerEntries.findFirst({ where: eq(ledgerEntries.id, entries[1]!.id) })
    ).toMatchObject({ convertedAmount: entries[1]!.convertedAmount });
  });

  it("converts every active entry when the document date changes", async () => {
    const { ledgerId, sourceDocumentId } = await fixture();
    const convert = vi.spyOn(postgresFxRateBook, "convertBatch").mockResolvedValue([
      { convertedAmount: "80", exchangeRate: "8" },
      { convertedAmount: "80", exchangeRate: "8" },
    ]);
    await aggregate.saveChanges({
      ledgerId,
      sourceDocumentId,
      expectedVersion: 1,
      sourceDocument: { documentDate: "2026-01-02" },
      entries: [],
    });
    expect(convert).toHaveBeenCalledExactlyOnceWith(
      [
        { amount: "10.000", from: "USD", date: "2026-01-02" },
        { amount: "10.000", from: "USD", date: "2026-01-02" },
      ],
      "CNY"
    );
  });

  it("rejects a version changed while FX I/O is running", async () => {
    const { db, ledgerId, sourceDocumentId, entries } = await fixture();
    vi.spyOn(postgresFxRateBook, "convertBatch").mockImplementation(async () => {
      await db
        .update(sourceDocuments)
        .set({ version: 2 })
        .where(eq(sourceDocuments.id, sourceDocumentId));
      return [{ convertedAmount: "140", exchangeRate: "7" }];
    });
    expect(
      await aggregate.saveChanges({
        ledgerId,
        sourceDocumentId,
        expectedVersion: 1,
        entries: [{ ledgerEntryId: entries[0]!.id, data: { amount: "20" } }],
      })
    ).toMatchObject({ ok: false, reason: "stale", currentVersion: 2 });
    expect(
      await db.query.ledgerEntries.findFirst({ where: eq(ledgerEntries.id, entries[0]!.id) })
    ).toMatchObject({ amount: entries[0]!.amount });
  });
});
