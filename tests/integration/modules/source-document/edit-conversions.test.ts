import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestUserWithLedger, testBookId } from "tests/helpers/schema-setup";
import * as exchangeRates from "@/modules/currency/server/exchange-rates";
import { ledgerEntries, sourceDocuments } from "@/persistence";
import { createManualDocument } from "@/modules/source-document/server/projections/writes";
import { saveSourceDocumentChanges } from "@/modules/source-document/server/updates";

afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const db = getTestDb();
  const { ledgerId } = await createTestUserWithLedger(db);
  const bookId = await testBookId(db, ledgerId);
  const created = await createManualDocument({
    ledgerId,
    bookId: bookId,
    title: "Original",
    entryDate: "2026-01-01",
    entries: ["One", "Two"].map((itemName) => ({
      categoryId: null,
      amount: "10",
      currency: "USD",
      itemName,
      description: null,
    })),
  });
  const entries = await db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.sourceDocumentRevisionId, created.revisionId));
  return { db, ledgerId, ...created, entries };
}

describe("document edit rate caching", () => {
  it("asks for no rates when only titles and entry metadata change", async () => {
    const { db, ledgerId, sourceDocumentId, entries } = await fixture();
    const ensure = vi.spyOn(exchangeRates, "ensureExchangeRates");
    const result = await saveSourceDocumentChanges({
      ledgerId,
      sourceDocumentId,
      expectedVersion: 1,
      sourceDocument: { title: "Renamed" },
      entries: [{ ledgerEntryId: entries[0]!.id, data: { description: "Note" } }],
    });
    expect(result).toMatchObject({ ok: true, version: 2 });
    expect(ensure).not.toHaveBeenCalled();
    expect(
      await db.query.ledgerEntries.findFirst({ where: eq(ledgerEntries.id, entries[0]!.id) })
    ).toMatchObject({ amount: "10.000", description: "Note" });
  });

  it("asks once for the document day when a foreign amount changes", async () => {
    const { ledgerId, sourceDocumentId, entries } = await fixture();
    const ensure = vi.spyOn(exchangeRates, "ensureExchangeRates");
    await saveSourceDocumentChanges({
      ledgerId,
      sourceDocumentId,
      expectedVersion: 1,
      entries: [
        { ledgerEntryId: entries[0]!.id, data: { amount: "20" } },
        { ledgerEntryId: entries[1]!.id, data: { itemName: "Renamed" } },
      ],
    });
    expect(ensure).toHaveBeenCalledExactlyOnceWith(["2026-01-01"]);
  });

  it("asks for the new day when the document date changes", async () => {
    const { ledgerId, sourceDocumentId } = await fixture();
    const ensure = vi.spyOn(exchangeRates, "ensureExchangeRates");
    await saveSourceDocumentChanges({
      ledgerId,
      sourceDocumentId,
      expectedVersion: 1,
      sourceDocument: { documentDate: "2026-01-02" },
      entries: [],
    });
    expect(ensure).toHaveBeenCalledExactlyOnceWith(["2026-01-02"]);
  });

  it("rejects a version changed while rates are being fetched", async () => {
    const { db, ledgerId, sourceDocumentId, entries } = await fixture();
    vi.spyOn(exchangeRates, "ensureExchangeRates").mockImplementation(async () => {
      await db
        .update(sourceDocuments)
        .set({ version: 2 })
        .where(eq(sourceDocuments.id, sourceDocumentId));
    });
    expect(
      await saveSourceDocumentChanges({
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
