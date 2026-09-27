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
