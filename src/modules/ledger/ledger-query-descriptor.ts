import type {
  LedgerStatsQueryInput,
  ListLedgerEntriesInput,
} from "@/modules/ledger/contract-schemas";
import { buildDetailsFilterKey, type LedgerAdvancedFilters } from "@/modules/ledger/ledger-query";
import { periodKey, type Period, type PeriodQuery } from "@/modules/ledger/domain/period";
import { normalizeSearchTerm } from "@/lib/search";
import { queryKeys } from "@/lib/query-keys";

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
  filterKey: string | null;
  summaryQueryKey: readonly unknown[];
  entriesQueryKey: readonly unknown[];
  /** The 汇总 read's own input: every caller hands it over as it stands. */
  summaryInput: PeriodQuery<LedgerStatsQueryInput>;
  getEntriesInput: (pageParam?: string) => PeriodQuery<ListLedgerEntriesInput>;
}

export function buildDetailsQueryDescriptor(input: {
  bookId?: string;
  period: Period;
  advancedFilters?: LedgerAdvancedFilters | undefined;
  mainCurrency: string;
}): DetailsQueryDescriptor {
  const filters = normalizeAdvancedFilters(input.advancedFilters);
  const filterKey = buildDetailsFilterKey(filters);
  const period = periodKey(input.period);
  const detailsFilters = {
    ...(input.bookId == null ? {} : { bookId: input.bookId }),
    period: input.period,
    ...(filters.categoryId != null ? { categoryId: filters.categoryId } : {}),
    ...(filters.currency != null ? { currency: filters.currency } : {}),
    ...(filters.minAmount != null ? { minAmount: filters.minAmount } : {}),
    ...(filters.maxAmount != null ? { maxAmount: filters.maxAmount } : {}),
    ...(filters.search != null ? { search: filters.search } : {}),
  };

  return {
    filterKey,
    summaryQueryKey: queryKeys.summary({
      bookId: input.bookId,
      period,
      currency: input.mainCurrency,
      filter: filterKey,
    }),
    entriesQueryKey: queryKeys.ledgerEntries({
      bookId: input.bookId,
      mode: "infinite",
      period,
      filter: filterKey,
    }),
    summaryInput: detailsFilters,
    getEntriesInput: (pageParam) => ({
      ...detailsFilters,
      ...(pageParam != null ? { cursor: pageParam } : {}),
      limit: DETAILS_PAGE_LIMIT,
    }),
  };
}
