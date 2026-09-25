import { sql } from "drizzle-orm";
import { describe, it, expect, beforeEach } from "vitest";
import { getTestDb } from "../setup";
import {
  activateTestSourceDocumentProjection,
  createTestUserWithLedger,
  TEST_USER_ID,
} from "../helpers/schema-setup";
import { ledgerEntries, ledgers, sourceDocuments } from "@/persistence";
import { getLedgerStatsAction } from "@/modules/ledger/server/stats";
import { eq } from "drizzle-orm";
import { insertExchangeRates } from "../helpers/exchange-rates";

describe("Stats Currency Conversion", () => {
  let ledgerId: string;

  beforeEach(async () => {
    const db = getTestDb();
    await db.delete(ledgers);
    const setup = await createTestUserWithLedger(db, undefined, "Converter Ledger", TEST_USER_ID);
    ledgerId = setup.ledgerId;

    await db
      .update(ledgers)
      .set({
        mainCurrency: "CNY",
      })
      .where(eq(ledgers.id, ledgerId));

    await db.delete(ledgerEntries).where(eq(ledgerEntries.ledgerId, ledgerId));
  });

  it("converts every currency by the document day's rates", async () => {
    const db = getTestDb();
    await insertExchangeRates("2024-01-01", { CNY: 7.8, MYR: 5, USD: 1.08 });

    const [sourceDoc] = await db
      .insert(sourceDocuments)
      .values({
        ledgerId,
        documentDate: "2024-01-01",
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    expect(sourceDoc).toBeDefined();
    if (sourceDoc == null) {
      throw new Error("Expected source document to be created");
    }

    await db.insert(ledgerEntries).values({
      ledgerId,
      sourceDocumentId: sourceDoc.id,
      amount: "100.00",
      currency: "MYR",
      itemName: "MYR Item",
    });

    await db.insert(ledgerEntries).values({
      ledgerId,
      sourceDocumentId: sourceDoc.id,
      amount: "50.00",
      currency: "USD",
      itemName: "USD Item",
    });

    await db.insert(ledgerEntries).values({
      ledgerId,
      sourceDocumentId: sourceDoc.id,
      amount: "100.00",
      currency: "CNY",
      itemName: "CNY Item",
    });
    await activateTestSourceDocumentProjection(db, sourceDoc.id);

    const stats = await getLedgerStatsAction({});

    expect(stats.convertedTotal?.currency).toBe("CNY");
    expect(stats.convertedTotal?.total).toBeCloseTo(617.11, 1);
  });

  it("converts an undated document by its UTC creation day's rates", async () => {
    const db = getTestDb();
    await insertExchangeRates("2024-02-10", { CNY: 8, USD: 1 });
    await insertExchangeRates("2024-02-11", { CNY: 9, USD: 1 });
    const [sourceDoc] = await db
      .insert(sourceDocuments)
      .values({
        ledgerId,
        documentDate: null,
        createdAt: new Date("2024-02-10T23:30:00Z"),
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    await db.insert(ledgerEntries).values({
      ledgerId,
      sourceDocumentId: sourceDoc!.id,
      amount: "10.00",
      currency: "USD",
      itemName: "Undated USD Item",
    });
    await activateTestSourceDocumentProjection(db, sourceDoc!.id);

    const stats = await getLedgerStatsAction({});

    expect(stats.convertedTotal).toEqual({ total: "80", currency: "CNY" });
  });
});
