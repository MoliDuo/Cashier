import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb } from "../setup";
import {
  activateTestSourceDocumentProjection,
  createTestUserWithLedger,
  TEST_USER_ID,
} from "../helpers/schema-setup";
import { ledgerEntries, ledgers, sourceDocuments } from "@/persistence";
import { getLedgerStatsAction } from "@/modules/ledger/server/stats";

describe("ledger summary soft-delete regression", () => {
  let ledgerId: string;

  beforeEach(async () => {
    const db = getTestDb();
    await db.delete(ledgers);
    ({ ledgerId } = await createTestUserWithLedger(db, undefined, "Stats Ledger", TEST_USER_ID));
  });

  it("excludes soft-deleted entries from totals and counts", async () => {
    const db = getTestDb();
    const [sourceDocument] = await db
      .insert(sourceDocuments)
      .values({
        ledgerId,
        documentDate: "2024-01-01",
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    if (sourceDocument == null) throw new Error("Expected source document");

    await db.insert(ledgerEntries).values([
      {
        ledgerId,
        sourceDocumentId: sourceDocument.id,
        amount: "100.00",
        currency: "CNY",
        itemName: "Active Item",
      },
      {
        ledgerId,
        sourceDocumentId: sourceDocument.id,
        amount: "500.00",
        currency: "CNY",
        itemName: "Deleted Item",
        deletedAt: new Date(),
      },
    ]);
    await activateTestSourceDocumentProjection(db, sourceDocument.id);

    const stats = await getLedgerStatsAction({});

    expect(stats.totals).toContainEqual({ currency: "CNY", total: "100", count: 1 });
  });
});
