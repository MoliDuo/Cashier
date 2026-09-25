import { exchangeRates } from "@/persistence/schema/currency";
import { getTestDb } from "../setup";

/**
 * Stores one day's final rates, as units of each currency one euro buys; EUR
 * itself is added. Reads convert entries on that day with them.
 */
export async function insertExchangeRates(
  rateDate: string,
  perEur: Record<string, number | string>,
  options: { sourceDate?: string | null; fetchedAt?: Date } = {}
): Promise<void> {
  const fetchedAt = options.fetchedAt ?? new Date();
  const sourceDate = options.sourceDate === undefined ? rateDate : options.sourceDate;
  await getTestDb()
    .insert(exchangeRates)
    .values(
      Object.entries({ ...perEur, EUR: 1 }).map(([currency, value]) => ({
        rateDate,
        currency,
        perEur: String(value),
        sourceDate,
        fetchedAt,
      }))
    );
}
