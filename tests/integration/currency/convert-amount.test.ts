import { afterEach, describe, expect, it, vi } from "vitest";
import { getTestDb } from "../../setup";
import { currencyRates } from "@/persistence/schema/currency";
import { convertAmount } from "@/modules/currency/server/exchange-rates";

describe("convertAmount", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a no-op conversion when currencies already match", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");

    const result = await convertAmount({
      amount: "100",
      fromCurrency: "CNY",
      toCurrency: "CNY",
      date: "2026-02-04",
    });

    expect(result).toEqual({
      convertedAmount: "100.00",
      exchangeRate: "1",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("converts with the stored rates for the entry date", async () => {
    await getTestDb()
      .insert(currencyRates)
      .values({ date: "2026-02-04", base: "EUR", rates: { USD: 1.1, CNY: 7.5 } });

    const result = await convertAmount({
      amount: "11",
      fromCurrency: "USD",
      toCurrency: "CNY",
      date: "2026-02-04",
    });

    expect(result.convertedAmount).toBe("75.00");
  });

  it("rejects when exchange-rate lookup fails", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    } as Response);

    await expect(
      convertAmount({
        amount: "100",
        fromCurrency: "USD",
        toCurrency: "CNY",
        date: "2026-02-05",
      })
    ).rejects.toThrow("Exchange rates unavailable for date: 2026-02-05");
  });

  it.each([
    ["USD", "1.235", "1.24"],
    ["JPY", "1.5", "2"],
    ["KWD", "1.2345", "1.235"],
  ])("rounds same-currency %s amounts to its minor unit", async (currency, amount, expected) => {
    await expect(
      convertAmount({ amount, fromCurrency: currency, toCurrency: currency })
    ).resolves.toEqual({ convertedAmount: expected, exchangeRate: "1" });
  });
});
