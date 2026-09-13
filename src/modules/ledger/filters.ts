import type { SourceDocumentProcessingStatus } from "@/modules/source-document/types";

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
  startDate?: string | null;
  endDate?: string | null;
  categoryId?: string | null;
  uncategorizedOnly?: boolean;
  currency?: string | null;
  minAmount?: string | null;
  maxAmount?: string | null;
  search?: string | null;
}
