import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestLedger, testBookId, createTestRecord } from "tests/helpers/schema-setup";
import * as exchangeRates from "@/modules/currency/server/exchange-rates";
import { ledgerEntries, sourceDocuments } from "@/persistence";
import { batchUpdateLedgerEntries } from "@/modules/source-document/server/entry-commands";
import { updateSourceDocuments } from "@/modules/source-document/server/updates";

afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const db = getTestDb();
  await createTestLedger(db);
  const bookId = await testBookId(db);
  const created = await createTestRecord(getTestDb(), {
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
  return { db, ...created, entries };
}

describe("document edit rate caching", () => {
  it("asks for no rates when only titles and entry metadata change", async () => {
    const { db, sourceDocumentId, entries } = await fixture();
    const ensure = vi.spyOn(exchangeRates, "ensureExchangeRates");
    await expect(
      updateSourceDocuments({
        sourceDocumentIds: [sourceDocumentId],
        data: { title: "Renamed" },
      })
    ).resolves.toMatchObject({ updatedCount: 1 });
    await expect(
      batchUpdateLedgerEntries({
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
    const { sourceDocumentId } = await fixture();
    const ensure = vi.spyOn(exchangeRates, "ensureExchangeRates");
    await updateSourceDocuments({
      sourceDocumentIds: [sourceDocumentId],
      data: { documentDate: "2026-01-02" },
    });
    expect(ensure).toHaveBeenCalledExactlyOnceWith(["2026-01-02"]);
  });
});
