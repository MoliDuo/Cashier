import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import {
  currencyRates,
  exchangeRateRecalculationJobs,
  exchangeRates,
  ledgerEntries,
  ledgers,
  sourceDocuments,
} from "@/persistence";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@/config/currencies";
import { dateStringSchema } from "@/lib/validation";
import { convertWithRates, type ExchangeRates } from "../domain/rate-calculation";
import { roundToCurrency } from "@/lib/money/currency-precision";

// Exchange-rate cache backed by the currency_rates table and the Frankfurter API.
// Final snapshots are also written to exchange_rates, which reads switch to next.

const supportedCurrencySet = new Set<string>(SUPPORTED_CURRENCIES);

function assertSupportedCurrency(currency: string): void {
  if (!supportedCurrencySet.has(currency)) {
    throw new AppError(`Currency not found: ${currency}`, "CURRENCY_NOT_FOUND", 400);
  }
}

const providerCurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, "Invalid currency code");
const providerBaseCurrencySchema = providerCurrencyCodeSchema.refine(
  (code) => supportedCurrencySet.has(code),
  "Unsupported base currency"
);

const providerRatesSchema = z.object({
  base: providerBaseCurrencySchema,
  date: dateStringSchema,
  rates: z.record(providerCurrencyCodeSchema, z.number().finite().positive()),
});

/**
 * Validate a Frankfurter-style provider payload before anything is written.
 * Rejects malformed dates, unsupported bases, invalid rate codes, and
 * non-finite or non-positive rates without touching the database.
 */
function parseProviderRates(
  data: unknown,
  targetDate: string
): { rates: ExchangeRates; providerDate: string } {
  const result = providerRatesSchema.safeParse(data);
  if (!result.success) {
    throw new AppError(
      "Invalid exchange-rate provider response",
      "EXCHANGE_RATES_INVALID_RESPONSE",
      502
    );
  }
  return {
    rates: {
      base: result.data.base,
      date: targetDate,
      rates: Object.fromEntries(
        Object.entries(result.data.rates).filter(([currency]) => supportedCurrencySet.has(currency))
      ),
    },
    providerDate: result.data.date,
  };
}

/**
 * The provider answers a date with the latest rates published on or before
 * it, so an earlier provider date is the applicable rate for a past day
 * (a Saturday gets Friday's rates). For today or a future day it only means
 * the day's rates are not out yet, and caching them would pin the previous
 * day's rates to that date for good.
 */
function isFinalForDate(providerDate: string, targetDate: string): boolean {
  return providerDate >= targetDate || targetDate < formatExchangeRateDate(new Date());
}

// helpers
export function formatExchangeRateDate(date: Date | string): string {
  if (typeof date === "string") {
    const [datePart] = date.split("T");
    return dateStringSchema.parse(datePart ?? date);
  }

  return dateStringSchema.parse(date.toISOString().slice(0, 10));
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Fetch with a fixed retry budget (default 3 attempts): network failures,
 * HTTP 408, 429, and 5xx are retried with exponential backoff (1s, 2s);
 * other 4xx responses are returned immediately so the caller can handle them.
 * Every request keeps a 5000ms timeout.
 */
export async function fetchWithRetry(url: string, retries = 3, delay = 1000): Promise<Response> {
  let lastError: unknown = new AppError(
    "Failed to fetch exchange rates",
    "EXCHANGE_RATES_FETCH_FAILED"
  );

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.ok || !isRetryableHttpStatus(response.status)) {
        return response;
      }
      lastError = new AppError(
        `Failed to fetch exchange rates: HTTP ${response.status}`,
        "EXCHANGE_RATES_FETCH_FAILED"
      );
    } catch (err) {
      lastError = err;
    }
    if (i < retries - 1) {
      await new Promise((resolve) => setTimeout(resolve, delay * Math.pow(2, i)));
    }
  }

  throw lastError;
}

const API_BASE_URL = "https://api.frankfurter.app";

const pendingRequests = new Map<string, Promise<ExchangeRates>>();

/**
 * Get rates for a specific date (defaults to today).
 * Uses "Daily Snapshot" strategy:
 * 1. Check DB for date.
 * 2. If missing, fetch from Frankfurter (base=EUR) and cache.
 * 3. Return rates.
 */
export async function getExchangeRates(date?: Date | string): Promise<ExchangeRates> {
  const targetDateStr = formatExchangeRateDate(date ?? new Date());

  const cached = await db.query.currencyRates.findFirst({
    where: eq(currencyRates.date, targetDateStr),
  });

  if (cached) {
    return {
      base: cached.base,
      date: cached.date,
      rates: cached.rates as Record<string, number>,
    };
  }

  // Request collapsing: register the pending fetch before any await so
  // concurrent callers for the same date share one provider request.
  let fetchPromise = pendingRequests.get(targetDateStr);
  if (fetchPromise === undefined) {
    fetchPromise = fetchAndStoreRates(targetDateStr);
    pendingRequests.set(targetDateStr, fetchPromise);
  }

  return fetchPromise;
}

async function fetchAndStoreRates(targetDateStr: string): Promise<ExchangeRates> {
  try {
    const response = await fetchWithRetry(`${API_BASE_URL}/${targetDateStr}?base=EUR`);

    if (!response.ok) {
      if (response.status === 404) {
        throw new AppError(
          `Exchange rates unavailable for date: ${targetDateStr}`,
          "EXCHANGE_RATES_UNAVAILABLE"
        );
      }
      throw new AppError(
        `Failed to fetch exchange rates: ${response.statusText}`,
        "EXCHANGE_RATES_FETCH_FAILED"
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AppError(
        "Invalid exchange-rate provider response",
        "EXCHANGE_RATES_INVALID_RESPONSE",
        502
      );
    }
    const { rates: data, providerDate } = parseProviderRates(payload, targetDateStr);
    if (!isFinalForDate(providerDate, targetDateStr)) return data;

    return await db.transaction(async (tx) => {
      if (data.base === "EUR") {
        await tx
          .insert(exchangeRates)
          .values(
            Object.entries({ ...data.rates, EUR: 1 }).map(([currency, perEur]) => ({
              rateDate: targetDateStr,
              currency,
              perEur: String(perEur),
              sourceDate: providerDate,
            }))
          )
          .onConflictDoNothing();
      }
      const insertedRows = await tx
        .insert(currencyRates)
        .values({ date: targetDateStr, base: data.base, rates: data.rates })
        .onConflictDoNothing()
        .returning();

      if (insertedRows.length === 0) {
        const persisted = await tx.query.currencyRates.findFirst({
          where: eq(currencyRates.date, targetDateStr),
        });
        if (persisted == null) {
          throw new AppError("Stored exchange rates disappeared", "EXCHANGE_RATES_UNAVAILABLE");
        }
        return {
          base: persisted.base,
          date: persisted.date,
          rates: persisted.rates,
        };
      }

      await tx.execute(sql`
        INSERT INTO ${exchangeRateRecalculationJobs} (rate_date, ledger_id)
        SELECT ${targetDateStr}, ${ledgers.id}
        FROM ${ledgers}
        INNER JOIN ${sourceDocuments}
          ON ${sourceDocuments.ledgerId} = ${ledgers.id}
          AND (${sourceDocuments.documentDate} = ${targetDateStr} OR ${sourceDocuments.documentDate} IS NULL)
          AND ${sourceDocuments.deletedAt} IS NULL
        INNER JOIN ${ledgerEntries}
          ON ${ledgerEntries.ledgerId} = ${ledgers.id}
          AND ${ledgerEntries.sourceDocumentId} = ${sourceDocuments.id}
          AND ${ledgerEntries.deletedAt} IS NULL
          AND (
            ${sourceDocuments.activeRevisionId} = ${ledgerEntries.sourceDocumentRevisionId}
            OR ${sourceDocuments.latestSubmissionRevisionId} = ${ledgerEntries.sourceDocumentRevisionId}
          )
        ON CONFLICT (rate_date, ledger_id) DO NOTHING
      `);
      return data;
    });
  } finally {
    // Remove from pending map once finished (success or failure)
    pendingRequests.delete(targetDateStr);
  }
}

export interface ConvertAmountInput {
  amount: string;
  fromCurrency: string;
  toCurrency: string;
  date?: Date | string;
}

export interface ConvertedAmount {
  convertedAmount: string;
  exchangeRate: string;
}

/** Convert one amount using the rates for its date (defaults to today). */
export async function convertAmount({
  amount,
  fromCurrency,
  toCurrency,
  date,
}: ConvertAmountInput): Promise<ConvertedAmount> {
  assertSupportedCurrency(fromCurrency);
  assertSupportedCurrency(toCurrency);
  if (fromCurrency === toCurrency) {
    return { convertedAmount: roundToCurrency(amount, toCurrency), exchangeRate: "1" };
  }

  const rates = await getExchangeRates(date === "" ? undefined : date);
  return convertWithRates(amount, rates, fromCurrency, toCurrency);
}

/**
 * Batch convert multiple amounts, loading one rates snapshot per distinct
 * date. For N items with M unique dates, this performs M DB queries instead of N.
 */
export async function convertAmounts(
  items: Array<{ amount: string; from: string; date?: Date | string }>,
  targetCurrency: string
): Promise<ConvertedAmount[]> {
  if (items.length === 0) return [];
  assertSupportedCurrency(targetCurrency);
  for (const item of items) assertSupportedCurrency(item.from);

  // 1. Same-currency items never touch the database or provider.
  const crossCurrencyItems = items.filter((item) => item.from !== targetCurrency);

  // 2. Collect all unique dates for cross-currency items only.
  const uniqueDates = [
    ...new Set(crossCurrencyItems.map((item) => formatExchangeRateDate(item.date ?? new Date()))),
  ];

  // 3. Pre-load one rates snapshot per date (M DB queries for M dates).
  const ratesByDate = new Map<string, ExchangeRates>();
  await Promise.all(
    uniqueDates.map(async (date) => {
      ratesByDate.set(date, await getExchangeRates(date));
    })
  );

  // 4. Map results synchronously using the pre-loaded snapshots.
  return items.map((item) => {
    if (item.from === targetCurrency) {
      return { convertedAmount: roundToCurrency(item.amount, targetCurrency), exchangeRate: "1" };
    }

    const dateKey = formatExchangeRateDate(item.date ?? new Date());
    const ratesData = ratesByDate.get(dateKey);
    if (ratesData == null) {
      throw new AppError(
        `Missing exchange rates for grouped date: ${dateKey}`,
        "MISSING_EXCHANGE_RATES"
      );
    }
    return convertWithRates(item.amount, ratesData, item.from, targetCurrency);
  });
}
