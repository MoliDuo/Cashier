import { compare } from "@/lib/money/decimal";
import { normalizeSearchTerm } from "@/lib/search";
import type { SourceDocumentListItemDto } from "./contracts";

/** The entry filters a stream card's rows are narrowed by, as the stream SQL applies them. */
interface StreamFilterPolicy {
  minAmount?: string | null;
  maxAmount?: string | null;
  search?: string | null;
}

function normalizedSearch(search: StreamFilterPolicy["search"]): string | undefined {
  return normalizeSearchTerm(search);
}

function hasStreamEntryFilters(filters: StreamFilterPolicy): boolean {
  return (
    filters.minAmount != null ||
    filters.maxAmount != null ||
    normalizedSearch(filters.search) !== undefined
  );
}

/**
 * SQL baseConditions() applies amount and search predicates to one EXISTS
 * subquery. Keep the same all-predicates-on-one-entry semantics on the client.
 */
function matchesStreamEntry(
  entry: NonNullable<SourceDocumentListItemDto["ledgerEntries"]>[number],
  filters: Pick<StreamFilterPolicy, "minAmount" | "maxAmount" | "search">
): boolean {
  if (filters.minAmount != null || filters.maxAmount != null) {
    // The stream SQL only matches main-currency converted amounts; entries
    // without a conversion must never be treated as 1:1 matches.
    const amount = entry.convertedAmount;
    if (amount == null || amount === "") return false;
    try {
      if (filters.minAmount != null && compare(amount, String(filters.minAmount)) < 0) {
        return false;
      }
      if (filters.maxAmount != null && compare(amount, String(filters.maxAmount)) > 0) {
        return false;
      }
    } catch {
      return false;
    }
  }

  const search = normalizedSearch(filters.search)?.toLocaleLowerCase();
  if (search == null) return true;
  return (
    entry.itemName.toLocaleLowerCase().includes(search) ||
    (entry.description?.toLocaleLowerCase().includes(search) ?? false)
  );
}

export function filterStreamEntries(
  entries: SourceDocumentListItemDto["ledgerEntries"] | undefined,
  filters: Pick<StreamFilterPolicy, "minAmount" | "maxAmount" | "search">
): NonNullable<SourceDocumentListItemDto["ledgerEntries"]> {
  const resolvedEntries = entries ?? [];
  if (!hasStreamEntryFilters(filters)) return resolvedEntries;
  return resolvedEntries.filter((entry) => matchesStreamEntry(entry, filters));
}
