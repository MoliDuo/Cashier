import { type PeriodParams, periodToDateRange } from "@/lib/period-utils";
import { canonicalizeSourceDocumentProcessingStatuses } from "@/modules/source-document/types";
import type { SourceDocumentProcessingStatus } from "@/modules/source-document/types";
import type { LedgerEntryFilterParams } from "./filters";

export interface LedgerAdvancedFilters {
  categoryId?: string | null;
  currency?: string | null;
  minAmount?: string | null;
  maxAmount?: string | null;
  statuses?: SourceDocumentProcessingStatus[];
  search?: string | null;
}

export interface LedgerQuery extends LedgerEntryFilterParams {
  statuses?: SourceDocumentProcessingStatus[];
}

interface DetailsInitialQueryState {
  startDateStr: string | null;
  endDateStr: string | null;
  filterKey: string | null;
}

function nonBlank(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed == null || trimmed === "" ? null : trimmed;
}

function normalizeLedgerQuery(query: LedgerQuery): LedgerQuery {
  const statuses = canonicalizeSourceDocumentProcessingStatuses(query.statuses);
  return {
    ...(nonBlank(query.bookId) != null ? { bookId: nonBlank(query.bookId)! } : {}),
    ...(nonBlank(query.startDate) != null ? { startDate: nonBlank(query.startDate) } : {}),
    ...(nonBlank(query.endDate) != null ? { endDate: nonBlank(query.endDate) } : {}),
    ...(nonBlank(query.categoryId) != null ? { categoryId: nonBlank(query.categoryId) } : {}),
    ...(query.uncategorizedOnly === true ? { uncategorizedOnly: true } : {}),
    ...(nonBlank(query.currency) != null
      ? { currency: nonBlank(query.currency)!.toUpperCase() }
      : {}),
    ...(query.minAmount != null ? { minAmount: query.minAmount } : {}),
    ...(query.maxAmount != null ? { maxAmount: query.maxAmount } : {}),
    ...(statuses != null ? { statuses } : {}),
    ...(nonBlank(query.search) != null ? { search: nonBlank(query.search) } : {}),
  };
}

export function serializeLedgerQuery(query: LedgerQuery): string {
  const normalized = normalizeLedgerQuery(query);
  return JSON.stringify({
    bookId: normalized.bookId ?? null,
    startDate: normalized.startDate ?? null,
    endDate: normalized.endDate ?? null,
    categoryId: normalized.categoryId ?? null,
    uncategorizedOnly: normalized.uncategorizedOnly ?? false,
    currency: normalized.currency ?? null,
    minAmount: normalized.minAmount ?? null,
    maxAmount: normalized.maxAmount ?? null,
    statuses: normalized.statuses ?? null,
    search: normalized.search ?? null,
  });
}

export function buildDetailsFilterKey(filters: LedgerAdvancedFilters): string | null {
  const normalized = normalizeLedgerQuery(filters);
  const parts: string[] = [];
  if (normalized.categoryId != null) parts.push(`cat:${normalized.categoryId}`);
  if (normalized.currency != null) parts.push(`cur:${normalized.currency}`);
  if (normalized.minAmount != null) parts.push(`min:${normalized.minAmount}`);
  if (normalized.maxAmount != null) parts.push(`max:${normalized.maxAmount}`);
  if (normalized.search != null) parts.push(`search:${normalized.search}`);
  return parts.length === 0 ? null : parts.join("|");
}

export function getDetailsInitialQueryState(
  periodParams: PeriodParams,
  advancedFilters: LedgerAdvancedFilters = {},
  timeZone?: string
): DetailsInitialQueryState {
  const dateRange = periodToDateRange(periodParams, timeZone);
  return {
    startDateStr: dateRange.startDate ?? null,
    endDateStr: dateRange.endDate ?? null,
    filterKey: buildDetailsFilterKey(advancedFilters),
  };
}
