import type { SourceDocumentProcessingStatus } from "@/modules/source-document/types";

/**
 * Which book a tab is showing. `null` is 总账: every book at once. It narrows
 * the record set exactly like the other filters do, and it is also the value
 * the pull-down switcher stores.
 */
export type RecordScope = string | null;

export interface EntryFilters {
  startDate?: string;
  endDate?: string;
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
