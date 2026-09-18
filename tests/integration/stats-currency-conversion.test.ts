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

describe("Stats Currency Conversion", () => {
  let ledgerId: string;

  beforeEach(async () => {
    const db = getTestDb();
    await db.delete(ledgers).where(eq(ledgers.userId, TEST_USER_ID));
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

  it("aggregates persisted converted amounts across currencies", async () => {
    const db = getTestDb();

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
      convertedAmount: "156.00",
      itemName: "MYR Item",
    });

    await db.insert(ledgerEntries).values({
      ledgerId,
      sourceDocumentId: sourceDoc.id,
      amount: "50.00",
      currency: "USD",
      convertedAmount: "361.11",
      itemName: "USD Item",
    });

    await db.insert(ledgerEntries).values({
      ledgerId,
      sourceDocumentId: sourceDoc.id,
      amount: "100.00",
      currency: "CNY",
      convertedAmount: "100.00",
      itemName: "CNY Item",
    });
    await activateTestSourceDocumentProjection(db, sourceDoc.id);

    const stats = await getLedgerStatsAction(ledgerId);

    expect(stats.convertedTotal?.currency).toBe("CNY");
    expect(stats.convertedTotal?.total).toBeCloseTo(617.11, 1);
  });
});
