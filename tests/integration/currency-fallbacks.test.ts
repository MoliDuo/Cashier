import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb } from "../setup";
import { currencyRates } from "@/persistence/schema/currency";
import { convertAmount } from "@/modules/currency/server/exchange-rates";

async function insertTestRates(date: string, rates: Record<string, number>) {
  await getTestDb().insert(currencyRates).values({
    date,
    base: "EUR",
    rates,
  });
}

describe("currency fallbacks integration", () => {
  const testDate = "2026-03-20";

  beforeEach(async () => {
    await insertTestRates(testDate, {
      CNY: 7.5,
      USD: 1.1,
    });
  });

  it("single conversion still fails for unknown currency", async () => {
    await expect(
      convertAmount({ amount: "100", fromCurrency: "ZZZ", toCurrency: "USD", date: testDate })
    ).rejects.toThrow("Currency not found: ZZZ");
  });
});
