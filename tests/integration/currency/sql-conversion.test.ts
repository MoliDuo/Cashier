import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { exchangeRates } from "@/persistence/schema/currency";
import { SUPPORTED_CURRENCIES } from "@/config/currencies";
import { getCurrencyDecimals } from "@/lib/money/currency-precision";
import { compare } from "@/lib/money/decimal";
import {
  convertWithRates,
  resolveRateRatio,
  type ExchangeRates,
} from "@/modules/currency/domain/rate-calculation";

const DATE = "2026-03-02";
const rates: ExchangeRates = {
  base: "EUR",
  date: DATE,
  rates: {
    USD: 1.0856,
    CNY: 7.8123,
    JPY: 162.47,
    KWD: 0.33412,
    GBP: 0.85663,
    ISK: 150.3,
    HUF: 395.12,
    IDR: 17654.33,
  },
};

type Case = { amount: string; from: string; to: string };

/** Runs every case through convert_amount and exchange_ratio in one query. */
async function convertInSql(cases: readonly Case[]) {
  const result = await getTestDb().execute<{ converted: string | null; ratio: string | null }>(sql`
    SELECT convert_amount(c.amount, c.from_currency, c.to_currency, ${DATE}::date)::text AS converted,
           exchange_ratio(c.from_currency, c.to_currency, ${DATE}::date)::text AS ratio
    FROM unnest(
      ${`{${cases.map((c) => c.amount).join(",")}}`}::numeric[],
      ${`{${cases.map((c) => c.from).join(",")}}`}::text[],
      ${`{${cases.map((c) => c.to).join(",")}}`}::text[]
    ) WITH ORDINALITY AS c(amount, from_currency, to_currency, position)
    ORDER BY c.position
  `);
  return result.rows;
}

function expectParity(cases: readonly Case[], rows: Awaited<ReturnType<typeof convertInSql>>) {
  cases.forEach((c, index) => {
    const expected = convertWithRates(c.amount, rates, c.from, c.to);
    const row = rows[index]!;
    const label = `${c.amount} ${c.from}->${c.to}`;
    expect(row.converted, label).not.toBeNull();
    expect(compare(row.converted!, expected.convertedAmount), label).toBe(0);
  });
}

/** Deterministic PRNG so a failing case can be reproduced. */
function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("SQL currency conversion", () => {
  beforeEach(async () => {
    const db = getTestDb();
    await db.delete(exchangeRates);
    await db.insert(exchangeRates).values(
      Object.entries({ ...rates.rates, EUR: 1 }).map(([currency, perEur]) => ({
        rateDate: DATE,
        currency,
        perEur: String(perEur),
        sourceDate: DATE,
      }))
    );
  });

  it("matches the application's conversion on rounding edges and odd minor units", async () => {
    const cases: Case[] = [
      { amount: "0.005", from: "EUR", to: "EUR" },
      { amount: "-0.005", from: "EUR", to: "EUR" },
      { amount: "12.5", from: "USD", to: "CNY" },
      { amount: "-12.5", from: "USD", to: "CNY" },
      { amount: "1000", from: "JPY", to: "KWD" },
      { amount: "3.141", from: "KWD", to: "JPY" },
      { amount: "99.99", from: "EUR", to: "GBP" },
      { amount: "99.99", from: "GBP", to: "EUR" },
      { amount: "0", from: "USD", to: "ISK" },
      { amount: "123456789.12", from: "IDR", to: "HUF" },
      { amount: "7.77", from: "CNY", to: "CNY" },
    ];
    expectParity(cases, await convertInSql(cases));
  });

  it("matches the application's ratio and conversion on seeded random input", async () => {
    const random = mulberry32(20260925);
    const currencies = [...Object.keys(rates.rates), "EUR"];
    const cases: Case[] = Array.from({ length: 500 }, () => {
      const cents = Math.floor(random() * 10_000_000) - 2_000_000;
      const places = Math.floor(random() * 4);
      return {
        amount: (cents / 10 ** places).toFixed(places),
        from: currencies[Math.floor(random() * currencies.length)]!,
        to: currencies[Math.floor(random() * currencies.length)]!,
      };
    });
    const rows = await convertInSql(cases);

    expectParity(cases, rows);
    cases.forEach((c, index) => {
      if (c.from === c.to) return;
      const label = `${c.from}->${c.to}`;
      expect(compare(rows[index]!.ratio!, resolveRateRatio(rates, c.from, c.to)), label).toBe(0);
    });
  });

  it("answers null when a rate for the day is missing, but converts a currency to itself", async () => {
    const rows = await convertInSql([
      { amount: "10", from: "BHD", to: "USD" },
      { amount: "10", from: "USD", to: "BHD" },
      { amount: "10.0049", from: "BHD", to: "BHD" },
    ]);
    expect(rows.map((row) => row.converted)).toEqual([null, null, "10.005"]);

    const otherDay = await getTestDb().execute<{ converted: string | null }>(
      sql`SELECT convert_amount(10, 'USD', 'CNY', '2026-03-03')::text AS converted`
    );
    expect(otherDay.rows[0]!.converted).toBeNull();
  });

  it("uses the same minor units as the application for every supported currency", async () => {
    const result = await getTestDb().execute<{ currency: string; decimals: number }>(sql`
      SELECT currency, currency_decimals(currency) AS decimals
      FROM unnest(${`{${SUPPORTED_CURRENCIES.join(",")}}`}::text[]) AS currency
    `);
    expect(
      Object.fromEntries(result.rows.map((row) => [row.currency, Number(row.decimals)]))
    ).toEqual(
      Object.fromEntries(
        SUPPORTED_CURRENCIES.map((currency) => [currency, getCurrencyDecimals(currency)])
      )
    );
  });
});
