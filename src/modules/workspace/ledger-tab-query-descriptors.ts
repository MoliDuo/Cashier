import {
  canonicalizeSourceDocumentProcessingStatuses,
  type SourceDocumentProcessingStatus,
} from "@/modules/source-document/types";
import type { GetStreamTotalInput } from "@/modules/source-document/application/queries/get-stream-total";
import type { ListStreamPageInput } from "@/modules/source-document/application/queries/list-stream-page";
import type { GetEnhancedStatsInput } from "@/modules/stats/contract-schemas";
import { normalizeSearchTerm } from "@/lib/search";
import { queryKeys } from "@/lib/query-keys";
import type { DateRangeType } from "@/lib/date-utils";
import {
  DEFAULT_STATS_RANGE_TYPE,
  getStatsInitialQueryState,
  type StatsInitialQueryState,
} from "./initial-query-state";

const STREAM_PAGE_LIMIT = 20;

export { buildDetailsQueryDescriptor } from "@/modules/ledger/ledger-query-descriptor";

export interface StreamQueryDescriptor {
  queryKey: readonly unknown[];
  totalQueryKey: readonly unknown[];
  filterSignature: string;
  getPageInput: (pageParam?: string) => ListStreamPageInput;
  totalInput: GetStreamTotalInput;
}

export function buildStreamQueryDescriptor(input: {
  ledgerId: string;
  attributedUserId?: string;
  startDate?: string | null | undefined;
  endDate?: string | null | undefined;
  minAmount?: string | null | undefined;
  maxAmount?: string | null | undefined;
  statuses?: readonly SourceDocumentProcessingStatus[] | null | undefined;
  search?: string | null | undefined;
}): StreamQueryDescriptor {
  const canonicalStatuses = canonicalizeSourceDocumentProcessingStatuses(
    input.statuses == null ? undefined : [...input.statuses]
  );
  const statusesKey = canonicalStatuses?.join(",") ?? null;
  const search = normalizeSearchTerm(input.search) ?? null;
  const baseInput = {
    ...(input.attributedUserId == null ? {} : { attributedUserId: input.attributedUserId }),
    ...(input.startDate != null && input.startDate !== "" ? { startDate: input.startDate } : {}),
    ...(input.endDate != null && input.endDate !== "" ? { endDate: input.endDate } : {}),
    ...(input.minAmount != null ? { minAmount: input.minAmount } : {}),
    ...(input.maxAmount != null ? { maxAmount: input.maxAmount } : {}),
    ...(canonicalStatuses != null ? { statuses: canonicalStatuses } : {}),
    ...(search != null ? { search } : {}),
  };
  const keyFilters = {
    attributedUserId: input.attributedUserId ?? null,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    minAmount: input.minAmount ?? null,
    maxAmount: input.maxAmount ?? null,
    statuses: statusesKey,
    search,
  };

  return {
    queryKey: queryKeys.sourceDocumentStream(input.ledgerId, keyFilters),
    totalQueryKey: queryKeys.sourceDocumentStreamTotal(input.ledgerId, keyFilters),
    filterSignature: JSON.stringify(keyFilters),
    getPageInput: (pageParam) => ({
      ...baseInput,
      ...(pageParam != null ? { cursor: pageParam } : {}),
      limit: STREAM_PAGE_LIMIT,
    }),
    totalInput: baseInput,
  };
}

export interface StatsQueryDescriptor {
  state: StatsInitialQueryState;
  queryKey: readonly unknown[];
  input: GetEnhancedStatsInput;
}

export function buildStatsQueryDescriptor(input: {
  ledgerId: string;
  attributedUserId?: string;
  currentDate: Date;
  mainCurrency: string;
  rangeType?: DateRangeType | undefined;
  currentPeriod?: boolean | undefined;
}): StatsQueryDescriptor {
  const statsOptions =
    input.currentPeriod === undefined ? {} : { currentPeriod: input.currentPeriod };
  const state = getStatsInitialQueryState(
    input.currentDate,
    input.rangeType ?? DEFAULT_STATS_RANGE_TYPE,
    statsOptions
  );

  return {
    state,
    queryKey: queryKeys.enhancedStats(input.ledgerId, {
      attributedUserId: input.attributedUserId ?? null,
      startDate: state.startDateStr,
      endDate: state.endDateStr,
      compareStartDate: state.prevDateStartStr,
      compareEndDate: state.prevDateEndStr,
      rangeType: state.rangeType,
      comparisonMode: state.mode,
      mainCurrency: input.mainCurrency,
    }),
    input: {
      ledgerId: input.ledgerId,
      ...(input.attributedUserId == null ? {} : { attributedUserId: input.attributedUserId }),
      queryRange: {
        from: state.startDateStr,
        to: state.endDateStr,
      },
      compareRange: {
        from: state.prevDateStartStr,
        to: state.prevDateEndStr,
      },
      comparisonMode: state.mode,
    },
  };
}
