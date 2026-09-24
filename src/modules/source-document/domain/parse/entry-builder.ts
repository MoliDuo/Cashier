import { formatDateTimeForApi } from "@/lib/date-utils";
import { compare } from "@/lib/money/decimal";
import { roundToCurrency } from "@/lib/money/currency-precision";
import type { CategoryInfo, ParsedLedgerEntry } from "@/lib/ai/types";

export interface EntryToInsert {
  id: string;
  ledgerId: string;
  categoryId: string | null;
  sourceDocumentId: string;
  amount: string;
  currency: string;
  itemName: string;
  description: string | null;
  entryDate: string;
  convertedAmount: string | null;
  exchangeRate: string | null;
  dateHint?: import("@/modules/source-document/date-organization-contracts").DateHint;
}

export interface BuildEntriesParams {
  validEntries: ParsedLedgerEntry[];
  categories: CategoryInfo[];
  sourceDocumentId: string;
  ledgerId: string;
  mainCurrency: string;
  fallbackDate: string;
  convertAmount: (input: {
    amount: string;
    fromCurrency: string;
    toCurrency: string;
    date: string;
  }) => Promise<{ convertedAmount: string; exchangeRate: string }>;
}

/**
 * Build entries for database insertion with currency conversion
 */
export async function buildEntriesForInsert({
  validEntries,
  categories,
  sourceDocumentId,
  ledgerId,
  mainCurrency,
  fallbackDate,
  convertAmount,
}: BuildEntriesParams): Promise<EntryToInsert[]> {
  return Promise.all(
    validEntries.map(async (entry) => {
      // categoryIndex is 1-based: 0 = no category, 1 = categories[0], 2 = categories[1], ...
      const categoryId =
        entry.categoryIndex > 0 && entry.categoryIndex <= categories.length
          ? (categories[entry.categoryIndex - 1]?.id ?? null)
          : null;

      const entryCurrency = entry.currency ?? "CNY";

      // Calculate converted amount
      let convertedAmount: string;
      let exchangeRate: string;

      if (entryCurrency === mainCurrency) {
        convertedAmount = roundToCurrency(String(entry.amount), mainCurrency);
        exchangeRate = "1";
      } else {
        const conversion = await convertAmount({
          amount: String(entry.amount),
          fromCurrency: entryCurrency,
          toCurrency: mainCurrency,
          date: fallbackDate,
        });
        convertedAmount = conversion.convertedAmount;
        exchangeRate = conversion.exchangeRate;
      }

      return {
        id: crypto.randomUUID(),
        ledgerId,
        categoryId,
        sourceDocumentId,
        amount: roundToCurrency(String(entry.amount), entryCurrency),
        currency: entryCurrency,
        itemName: entry.itemName !== "" ? entry.itemName : "Uncategorized",
        description: entry.notes ?? null,
        entryDate: fallbackDate,
        convertedAmount,
        exchangeRate,
        ...(entry.dateHint == null ? {} : { dateHint: entry.dateHint }),
      };
    })
  );
}

export interface ValidationResult {
  isValid: boolean;
  reason?: string;
}

/**
 * Validate entries before saving
 */
export function validateEntries(entries: ParsedLedgerEntry[]): ValidationResult {
  if (
    entries.some(
      (entry) =>
        compare(roundToCurrency(entry.amount, entry.currency ?? "CNY"), "0") === 0 ||
        (compare(entry.amount, "0") < 0 && entry.isAdjustment !== true)
    )
  ) {
    return { isValid: false, reason: "Invalid expense amount" };
  }
  // Adjustments (discounts, fees) may have negative amounts — keep them
  const positiveEntries = entries.filter(
    (entry) => compare(entry.amount, "0") > 0 || entry.isAdjustment === true
  );

  if (positiveEntries.length === 0) {
    return { isValid: false, reason: "No entries with valid amount" };
  }

  const unknownCurrencyEntries = positiveEntries.filter(
    (entry) =>
      entry.currency == null || entry.currency === "" || entry.currency.toLowerCase() === "unknown"
  );

  if (unknownCurrencyEntries.length > 0) {
    return { isValid: false, reason: "Unable to recognize currency type" };
  }

  return { isValid: true };
}

export interface DateFallbackResult {
  todayDate: string;
  fallbackDate: string;
}

/**
 * Get fallback date for entries
 */
export function getEntryFallbackDate(docEntryDate: string | null): DateFallbackResult {
  const todayDate = formatDateTimeForApi(new Date())!;
  const fallbackDate = docEntryDate ?? todayDate;

  return { todayDate, fallbackDate };
}
