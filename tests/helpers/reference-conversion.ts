/**
 * The JavaScript conversion the stored amounts were computed with before
 * reads converted in SQL; kept as the parity reference for convert_amount.
 */
import { multiply, divide, round } from "@/lib/money/decimal";
import { roundToCurrency } from "@/lib/money/currency-precision";
import { AppError } from "@/lib/errors";

export interface ExchangeRates {
  base: string;
  date: string;
  rates: Record<string, number>;
}

/**
 * Resolve the cross rate toCurrency / fromCurrency as a canonical decimal
 * string. The provider's base currency is implicit (rate 1) even when it is
 * not present in the rates map.
 */
export function resolveRateRatio(
  rates: ExchangeRates,
  fromCurrency: string,
  toCurrency: string
): string {
  const fullRates = { ...rates.rates, [rates.base]: 1 };
  const fromRate = fullRates[fromCurrency];
  const toRate = fullRates[toCurrency];

  if (
    fromRate == null ||
    toRate == null ||
    !Number.isFinite(fromRate) ||
    !Number.isFinite(toRate) ||
    fromRate <= 0 ||
    toRate <= 0
  ) {
    const missing =
      fromRate == null || !Number.isFinite(fromRate) || fromRate <= 0 ? fromCurrency : toCurrency;
    throw new AppError(`Currency not found: ${missing}`, "CURRENCY_NOT_FOUND", 400);
  }

  if (fromCurrency === toCurrency) return "1";
  return divide(String(toRate), String(fromRate));
}

/**
 * Convert an amount with an already-loaded rates snapshot. The exchange rate
 * is the actual to/from ratio; zero amounts keep the real ratio (never "1").
 */
export function convertWithRates(
  amount: string,
  rates: ExchangeRates,
  fromCurrency: string,
  toCurrency: string
): { convertedAmount: string; exchangeRate: string } {
  const rawRatio = resolveRateRatio(rates, fromCurrency, toCurrency);
  return {
    convertedAmount: roundToCurrency(multiply(amount, rawRatio), toCurrency),
    exchangeRate: round(rawRatio, 12),
  };
}
