import type { SourceDocumentProcessingStatus } from "@/modules/source-document/types";

/**
 * Which book a tab is showing. `null` is 总账: every book at once. It narrows
 * the record set exactly like the other filters do, and it is also the value
 * the pull-down switcher stores.
 */
export type RecordScope = string | null;

/** What the filter dialog narrows a list by; its days are the period's, not these. */
export interface EntryFilters {
  categoryId?: string | null;
  currency?: string | null;
  minAmount?: string | null;
  maxAmount?: string | null;
  statuses?: SourceDocumentProcessingStatus[];
  search?: string | null;
}

/**
 * How many of the filter's conditions narrow the list. The period has a bar of
 * its own, so it is not one of them; a condition the surface does not offer is
 * not counted either.
 */
export function countActiveEntryFilters(
  filters: EntryFilters,
  offered: { showCategory: boolean; showCurrency: boolean; showStatus: boolean }
): number {
  return [
    filters.search != null && filters.search.trim() !== "",
    offered.showStatus && (filters.statuses?.length ?? 0) > 0,
    offered.showCategory && filters.categoryId != null && filters.categoryId !== "",
    offered.showCurrency && filters.currency != null && filters.currency !== "",
    filters.minAmount !== undefined && filters.minAmount !== null,
    filters.maxAmount !== undefined && filters.maxAmount !== null,
  ].filter((x): x is true => x === true).length;
}

export interface LedgerEntryFilterParams {
  bookId?: string;
  startDate?: string | null;
  endDate?: string | null;
  categoryId?: string | null;
  uncategorizedOnly?: boolean;
  currency?: string | null;
  minAmount?: string | null;
  maxAmount?: string | null;
  search?: string | null;
}
