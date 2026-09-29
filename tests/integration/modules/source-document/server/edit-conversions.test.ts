import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestUserWithLedger, testBookId, createTestRecord } from "tests/helpers/schema-setup";
import * as exchangeRates from "@/modules/currency/server/exchange-rates";
import { ledgerEntries, sourceDocuments } from "@/persistence";
import { batchUpdateLedgerEntries } from "@/modules/source-document/server/entry-commands";
import { updateSourceDocuments } from "@/modules/source-document/server/updates";

afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const db = getTestDb();
  const { ledgerId } = await createTestUserWithLedger(db);
  const bookId = await testBookId(db, ledgerId);
  const created = await createTestRecord(getTestDb(), {
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
    .where(eq(ledgerEntries.sourceDocumentId, created.sourceDocumentId))
    .orderBy(ledgerEntries.position);
  return { db, ledgerId, ...created, entries };
}

describe("document edit rate caching", () => {
  it("asks for no rates when only titles and entry metadata change", async () => {
    const { db, ledgerId, sourceDocumentId, entries } = await fixture();
    const ensure = vi.spyOn(exchangeRates, "ensureExchangeRates");
    await expect(
      updateSourceDocuments({
        ledgerId,
        sourceDocumentIds: [sourceDocumentId],
        data: { title: "Renamed" },
      })
    ).resolves.toMatchObject({ updatedCount: 1 });
    await expect(
      batchUpdateLedgerEntries({
        ledgerId,
        sourceDocumentIds: [sourceDocumentId],
        ledgerEntryIds: [entries[0]!.id],
        description: "Note",
      })
    ).resolves.toMatchObject({ affectedCount: 1 });
    expect(ensure).not.toHaveBeenCalled();
    expect(
      await db.query.ledgerEntries.findFirst({ where: eq(ledgerEntries.id, entries[0]!.id) })
    ).toMatchObject({ amount: "10.000", description: "Note" });
    expect(
      await db.query.sourceDocuments.findFirst({ where: eq(sourceDocuments.id, sourceDocumentId) })
    ).toMatchObject({ title: "Renamed", version: 3 });
  });

  it("asks for the new day when the document date changes", async () => {
    const { ledgerId, sourceDocumentId } = await fixture();
    const ensure = vi.spyOn(exchangeRates, "ensureExchangeRates");
    await updateSourceDocuments({
      ledgerId,
      sourceDocumentIds: [sourceDocumentId],
      data: { documentDate: "2026-01-02" },
    });
    expect(ensure).toHaveBeenCalledExactlyOnceWith(["2026-01-02"]);
  });
});
