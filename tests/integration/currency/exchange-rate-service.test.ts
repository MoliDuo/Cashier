import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getExchangeRates } from "@/modules/currency/server/exchange-rates";
import { db } from "@/lib/db";
import { currencyRates } from "@/persistence/schema/currency";
import { eq } from "drizzle-orm";

describe("getExchangeRates", () => {
  beforeEach(async () => {
    // Clear cache and database
    await db.delete(currencyRates);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("collapses concurrent requests when the cache is empty", async () => {
    let callCount = 0;
    let resolveFetch!: (response: Response) => void;
    const fetchGate = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      callCount++;
      return fetchGate;
    });

    const date = new Date("2024-01-20");

    const promises = Array(10)
      .fill(null)
      .map(() => getExchangeRates(date));

    const allResults = Promise.all(promises);
    await vi.waitFor(() => expect(callCount).toBe(1));
    resolveFetch({
      ok: true,
      json: async () => ({
        base: "EUR",
        date: "2024-01-20",
        rates: { USD: 1.2 },
      }),
    } as Response);
    const results = await allResults;

    expect(new Set(results.map((r) => r.rates.USD)).size).toBe(1);
    expect(callCount).toBe(1);
  });

  it("filters valid provider currencies that are not enabled by the application", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        base: "EUR",
        date: "2024-01-18",
        rates: { USD: 1.15, CNY: 7.7, BGN: 1.9558 },
      }),
    } as Response);

    const result = await getExchangeRates("2024-01-18");
    expect(result.rates).toEqual({ USD: 1.15, CNY: 7.7 });
    expect(
      await db.query.currencyRates.findFirst({ where: eq(currencyRates.date, "2024-01-18") })
    ).toMatchObject({ rates: { USD: 1.15, CNY: 7.7 } });
  });

  it("uses the requested date for weekend responses and cache hits", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        base: "EUR",
        date: "2024-01-19",
        rates: { USD: 1.15, CNY: 7.7 },
      }),
    } as Response);

    const first = await getExchangeRates("2024-01-20");
    const cached = await getExchangeRates("2024-01-20");
    expect(first.date).toBe("2024-01-20");
    expect(cached.date).toBe("2024-01-20");
  });

  it.each([
    ["today before the day's rates are published", 0],
    ["a future day", 3],
  ])("does not cache the previous day's rates for %s", async (_label, daysAhead) => {
    const requested = new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        base: "EUR",
        date: "2024-01-19",
        rates: { USD: 1.15, CNY: 7.7 },
      }),
    } as Response);

    await expect(getExchangeRates(requested)).resolves.toMatchObject({
      date: requested,
      rates: { USD: 1.15, CNY: 7.7 },
    });
    expect(
      await db.query.currencyRates.findFirst({ where: eq(currencyRates.date, requested) })
    ).toBeUndefined();

    await getExchangeRates(requested);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("rejects an invalid provider payload without writing to the database", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        base: "EUR",
        date: "not-a-date",
        rates: { USD: 1.1 },
      }),
    } as Response);

    await expect(getExchangeRates("2024-01-22")).rejects.toThrow(
      "Invalid exchange-rate provider response"
    );

    const persisted = await db.query.currencyRates.findFirst({
      where: eq(currencyRates.date, "2024-01-22"),
    });
    expect(persisted).toBeUndefined();
  });

  it("rejects a provider base currency that is not enabled", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        base: "BGN",
        date: "2024-01-22",
        rates: { USD: 1.1, EUR: 0.51 },
      }),
    } as Response);

    await expect(getExchangeRates("2024-01-22")).rejects.toThrow(
      "Invalid exchange-rate provider response"
    );
    expect(
      await db.query.currencyRates.findFirst({ where: eq(currencyRates.date, "2024-01-22") })
    ).toBeUndefined();
  });

  it("rejects non-positive provider rates without writing", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        base: "EUR",
        date: "2024-01-23",
        rates: { USD: -1.1, CNY: 7.8 },
      }),
    } as Response);

    await expect(getExchangeRates("2024-01-23")).rejects.toThrow(
      "Invalid exchange-rate provider response"
    );

    const persisted = await db.query.currencyRates.findFirst({
      where: eq(currencyRates.date, "2024-01-23"),
    });
    expect(persisted).toBeUndefined();
  });

  it.each([
    ["invalid code", { US: 1.1 }],
    ["NaN", { USD: Number.NaN }],
    ["Infinity", { USD: Number.POSITIVE_INFINITY }],
  ])("rejects %s provider rates without writing", async (_label, rates) => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ base: "EUR", date: "2024-01-24", rates }),
    } as Response);

    await expect(getExchangeRates("2024-01-24")).rejects.toThrow(
      "Invalid exchange-rate provider response"
    );
    expect(
      await db.query.currencyRates.findFirst({ where: eq(currencyRates.date, "2024-01-24") })
    ).toBeUndefined();
  });
});
