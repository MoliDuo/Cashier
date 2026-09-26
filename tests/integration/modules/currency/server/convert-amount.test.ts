import { afterEach, describe, expect, it, vi } from "vitest";
import { convertAmount } from "@/modules/currency/server/exchange-rates";
import { insertExchangeRates } from "tests/helpers/exchange-rates";

describe("convertAmount", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the rounded amount without asking for rates when currencies already match", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");

    const result = await convertAmount({
      amount: "100",
      fromCurrency: "CNY",
      toCurrency: "CNY",
      date: "2026-02-04",
    });

    expect(result).toBe("100.00");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("converts with the stored rates for the entry date", async () => {
    await insertExchangeRates("2026-02-04", { USD: 1.1, CNY: 7.5 });
    const fetchSpy = vi.spyOn(global, "fetch");

    const result = await convertAmount({
      amount: "11",
      fromCurrency: "USD",
      toCurrency: "CNY",
      date: "2026-02-04",
    });

    expect(result).toBe("75.00");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches a missing day's rates before converting", async () => {
    // The mocked provider publishes USD 1 and CNY 8 per euro.
    await expect(
      convertAmount({ amount: "10", fromCurrency: "USD", toCurrency: "CNY", date: "2026-02-06" })
    ).resolves.toBe("80.00");
  });

  it("answers null when the provider cannot supply the day's rates", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
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
    ).resolves.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["USD", "1.235", "1.24"],
    ["JPY", "1.5", "2"],
    ["KWD", "1.2345", "1.235"],
  ])("rounds same-currency %s amounts to its minor unit", async (currency, amount, expected) => {
    await expect(
      convertAmount({ amount, fromCurrency: currency, toCurrency: currency })
    ).resolves.toBe(expected);
  });
});
