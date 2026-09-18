import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createLedgerEntryAction } from "@/modules/ledger/server-actions/entries";
import { ledgerEntries, ledgers, sourceDocuments } from "@/persistence";
import { getTestDb } from "../../setup";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
  TEST_USER_ID,
} from "../../helpers/schema-setup";

const { getRatesMock } = vi.hoisted(() => ({
  getRatesMock: vi.fn(async () => ({ base: "CNY", date: "2026-01-01", rates: {} })),
}));

vi.mock("@/application/adapters/postgres/exchange-rate", () => {
  const rateBook = { getRates: getRatesMock, convertBatch: vi.fn() };
  return { ExchangeRateService: rateBook, postgresFxRateBook: rateBook, fetchWithRetry: vi.fn() };
});

describe("createLedgerEntryAction version CAS", () => {
  let ledgerId: string;
  let sourceDocumentId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = getTestDb();
    ledgerId = crypto.randomUUID();
    sourceDocumentId = crypto.randomUUID();
    await db.insert(ledgers).values({ id: ledgerId, userId: TEST_USER_ID, mainCurrency: "CNY" });
    await ensureTestLedgerBooks(db, ledgerId);
    await db.insert(sourceDocuments).values({
      id: sourceDocumentId,
      ledgerId,
      bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
    });
    await activateTestSourceDocumentProjection(db, sourceDocumentId);
  });

  it("creates one entry, preserves a server UUID, and increments the document once", async () => {
    const result = await createLedgerEntryAction(
      ledgerId,
      { sourceDocumentId, expectedVersion: 1 },
      { sourceDocumentId, amount: "50", currency: "CNY", itemName: "Lunch" }
    );
    expect(result).toMatchObject({ ok: true, sourceDocumentId, version: 2 });
    if (!result.ok) throw new Error("Expected successful create");

    const db = getTestDb();
    const entry = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, result.data.ledgerEntryId),
    });
    const document = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, sourceDocumentId),
    });
    expect(entry).toMatchObject({ itemName: "Lunch", amount: "50.000", currency: "CNY" });
    expect(document?.version).toBe(2);
  });

  it("returns stale for a lost-response retry and creates no second entry", async () => {
    const command = () =>
      createLedgerEntryAction(
        ledgerId,
        { sourceDocumentId, expectedVersion: 1 },
        { sourceDocumentId, amount: "10", currency: "CNY", itemName: "Coffee" }
      );
    await expect(command()).resolves.toMatchObject({ ok: true, version: 2 });
    await expect(command()).resolves.toEqual({
      ok: false,
      reason: "stale",
      sourceDocumentId,
      expectedVersion: 1,
      currentVersion: 2,
    });
    const rows = await getTestDb()
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.sourceDocumentId, sourceDocumentId));
    expect(rows.filter((row) => row.id != null)).toHaveLength(1);
  });
});
