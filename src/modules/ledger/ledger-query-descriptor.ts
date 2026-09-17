import type { ListLedgerEntriesInput } from "@/modules/ledger/contract-schemas";
import {
  buildDetailsFilterKey,
  getDetailsInitialQueryState,
  type LedgerAdvancedFilters,
} from "@/modules/ledger/ledger-query";
import { normalizeSearchTerm } from "@/lib/search";
import { queryKeys } from "@/lib/query-keys";
import type { PeriodParams } from "@/lib/period-utils";

const DETAILS_PAGE_LIMIT = 50;

function normalizeAdvancedFilters(filters: LedgerAdvancedFilters = {}): LedgerAdvancedFilters {
  const search = normalizeSearchTerm(filters.search);
  return {
    ...(filters.categoryId !== undefined ? { categoryId: filters.categoryId } : {}),
    ...(filters.currency !== undefined ? { currency: filters.currency } : {}),
    ...(filters.minAmount !== undefined ? { minAmount: filters.minAmount } : {}),
    ...(filters.maxAmount !== undefined ? { maxAmount: filters.maxAmount } : {}),
    ...(filters.statuses !== undefined ? { statuses: filters.statuses } : {}),
    ...(search !== undefined ? { search } : {}),
  };
}

interface DetailsQueryDescriptor {
  startDateStr: string | null;
  endDateStr: string | null;
  filterKey: string | null;
  summaryQueryKey: readonly unknown[];
  entriesQueryKey: readonly unknown[];
  summaryParams: {
    startDate?: string;
    endDate?: string;
    filters: {
      attributedUserId?: string;
      categoryId?: string;
      currency?: string;
      minAmount?: string;
      maxAmount?: string;
      search?: string;
    };
  };
  getEntriesInput: (pageParam?: string) => ListLedgerEntriesInput;
}

export function buildDetailsQueryDescriptor(input: {
  ledgerId: string;
  attributedUserId?: string;
  periodParams: PeriodParams;
  advancedFilters?: LedgerAdvancedFilters | undefined;
  timeZone?: string | undefined;
  mainCurrency: string;
}): DetailsQueryDescriptor {
  const filters = normalizeAdvancedFilters(input.advancedFilters);
  const state = getDetailsInitialQueryState(input.periodParams, filters, input.timeZone);
  const filterKey = buildDetailsFilterKey(filters);
  const detailsFilters = {
    ...(input.attributedUserId == null ? {} : { attributedUserId: input.attributedUserId }),
    ...(filters.categoryId != null ? { categoryId: filters.categoryId } : {}),
    ...(filters.currency != null ? { currency: filters.currency } : {}),
    ...(filters.minAmount != null ? { minAmount: filters.minAmount } : {}),
    ...(filters.maxAmount != null ? { maxAmount: filters.maxAmount } : {}),
    ...(filters.search != null ? { search: filters.search } : {}),
  };

  return {
    startDateStr: state.startDateStr,
    endDateStr: state.endDateStr,
    filterKey,
    summaryQueryKey: queryKeys.summary(input.ledgerId, {
      attributedUserId: input.attributedUserId,
      startDate: state.startDateStr,
      endDate: state.endDateStr,
      currency: input.mainCurrency,
      filter: filterKey,
    }),
    entriesQueryKey: queryKeys.ledgerEntries(input.ledgerId, {
      attributedUserId: input.attributedUserId,
      mode: "infinite",
      startDate: state.startDateStr,
      endDate: state.endDateStr,
      filter: filterKey,
    }),
    summaryParams: {
      ...(state.startDateStr != null ? { startDate: state.startDateStr } : {}),
      ...(state.endDateStr != null ? { endDate: state.endDateStr } : {}),
      filters: detailsFilters,
    },
    getEntriesInput: (pageParam) => ({
      ...(input.attributedUserId == null ? {} : { attributedUserId: input.attributedUserId }),
      ...(state.startDateStr != null ? { startDate: state.startDateStr } : {}),
      ...(state.endDateStr != null ? { endDate: state.endDateStr } : {}),
      ...(filters.categoryId != null ? { categoryId: filters.categoryId } : {}),
      ...(filters.currency != null ? { currency: filters.currency } : {}),
      ...(filters.minAmount != null ? { minAmount: filters.minAmount } : {}),
      ...(filters.maxAmount != null ? { maxAmount: filters.maxAmount } : {}),
      ...(filters.search != null ? { search: filters.search } : {}),
      ...(pageParam != null ? { cursor: pageParam } : {}),
      limit: DETAILS_PAGE_LIMIT,
    }),
  };
}
