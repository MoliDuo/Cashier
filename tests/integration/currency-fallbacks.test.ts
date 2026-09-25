import { beforeEach, describe, expect, it } from "vitest";
import { convertAmount } from "@/modules/currency/server/exchange-rates";
import { insertExchangeRates } from "../helpers/exchange-rates";

describe("currency fallbacks integration", () => {
  const testDate = "2026-03-20";

  beforeEach(async () => {
    await insertExchangeRates(testDate, { CNY: 7.5, USD: 1.1 });
  });

  it("answers null for a currency without rates instead of another day's rate", async () => {
    await expect(
      convertAmount({ amount: "100", fromCurrency: "ZZZ", toCurrency: "USD", date: testDate })
    ).resolves.toBeNull();
  });
});
