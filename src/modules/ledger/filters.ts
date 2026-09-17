import type { SourceDocumentProcessingStatus } from "@/modules/source-document/types";

/**
 * Whose records a tab is showing: the whole ledger, the signed-in member's, or
 * the partner's. It narrows the record set exactly like the other filters do,
 * so it is offered inside the filter dialog rather than beside the toolbar.
 */
export type RecordScope = "all" | "mine" | "partner";

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
  attributedUserId?: string;
  startDate?: string | null;
  endDate?: string | null;
  categoryId?: string | null;
  uncategorizedOnly?: boolean;
  currency?: string | null;
  minAmount?: string | null;
  maxAmount?: string | null;
  search?: string | null;
}
