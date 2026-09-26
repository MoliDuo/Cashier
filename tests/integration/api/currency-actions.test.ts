import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTestDb } from "../../setup";
import { ledgers } from "@/persistence";
import { ensureTestLedgerBooks } from "../../helpers/schema-setup";
import { convertCurrencyAction } from "@/modules/currency/server-actions/convert-currency";
import { insertExchangeRates } from "../../helpers/exchange-rates";

const LEDGER_ID = "10000000-0000-4000-8000-000000000001";

vi.mock("@/modules/auth/server/current-session", async () => {
  const { testSession } = await import("../../helpers/session");
  return { getCurrentSession: vi.fn(async () => testSession()) };
});

async function insertRates(date: string, rates: Record<string, number>) {
  await insertExchangeRates(date, rates);
}

describe("currency action composition", () => {
  beforeEach(async () => {
    await getTestDb().insert(ledgers).values({
      id: LEDGER_ID,
    });
    await ensureTestLedgerBooks(getTestDb(), LEDGER_ID);
    await insertRates("2026-02-04", { CNY: 7.5, USD: 1.1 });
  });

  it("converts with the persisted historical rate", async () => {
    const result = await convertCurrencyAction("100", "CNY", "USD", "2026-02-04");

    expect(Number.parseFloat(result.converted)).toBeCloseTo(14.67, 1);
  });
});
