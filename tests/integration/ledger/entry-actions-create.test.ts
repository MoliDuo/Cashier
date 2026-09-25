import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createLedgerEntryAction } from "@/modules/ledger/server-actions/entries";
import { ledgerEntries, ledgers, sourceDocuments } from "@/persistence";
import { getTestDb } from "../../setup";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
} from "../../helpers/schema-setup";

describe("createLedgerEntryAction", () => {
  let ledgerId: string;
  let sourceDocumentId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = getTestDb();
    ledgerId = crypto.randomUUID();
    sourceDocumentId = crypto.randomUUID();
    await db.insert(ledgers).values({ id: ledgerId, mainCurrency: "CNY" });
    await ensureTestLedgerBooks(db, ledgerId);
    await db.insert(sourceDocuments).values({
      id: sourceDocumentId,
      ledgerId,
      bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
    });
    await activateTestSourceDocumentProjection(db, sourceDocumentId);
  });

  it("creates one entry, preserves a server UUID, and increments the document once", async () => {
    const result = await createLedgerEntryAction({
      sourceDocumentId,
      amount: "50",
      currency: "CNY",
      itemName: "Lunch",
    });
    expect(result).toEqual({ ledgerEntryId: expect.any(String) });

    const db = getTestDb();
    const entry = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, result.ledgerEntryId),
    });
    const document = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, sourceDocumentId),
    });
    expect(entry).toMatchObject({ itemName: "Lunch", amount: "50.000", currency: "CNY" });
    expect(document?.version).toBe(2);
  });
});
