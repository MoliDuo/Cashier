"use client";
import type { LedgerEntry } from "@/modules/ledger/contracts";
import { useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getLedgerEntriesAction, getLedgerStatsAction } from "@/lib/queries/ledger-query-client";
import { type PeriodParams } from "@/lib/period-utils";
import type { Ledger } from "@/modules/ledger/contracts";
import { QUERY } from "@/lib/constants";
import { buildDetailsQueryDescriptor } from "@/modules/ledger/ledger-query-descriptor";

export interface UseDetailsTabDataReturn {
  entries: LedgerEntry[];
  summaryData: Awaited<ReturnType<typeof getLedgerStatsAction>> | undefined;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  monthStats: {
    mainTotal: string | null;
    mainCurrency: string;
    unconvertedCount: number;
    hasMultipleCurrencies: boolean;
    breakdown: { currency: string; total: string; count: number }[];
  };
  filterKey: string | null;
  startDateStr: string | null;
  endDateStr: string | null;
  queryKey: readonly unknown[];
  queryStatus: "pending" | "success" | "error";
  queryIsFetching: boolean;
  queryHasData: boolean;
}

interface UseDetailsTabDataProps {
  ledgerId: string;
  bookId?: string;
  ledger?: Ledger;
  periodParams: PeriodParams;
  advancedFilters: {
    categoryId?: string | null;
    currency?: string | null;
    minAmount?: string | null;
    maxAmount?: string | null;
    search?: string | null;
  };
  timeZone?: string;
}

export function useDetailsTabData({
  ledgerId,
  bookId,
  ledger,
  periodParams,
  advancedFilters,
  timeZone,
}: UseDetailsTabDataProps): UseDetailsTabDataReturn {
  const mainCurrency = ledger?.settings.mainCurrency ?? "CNY";
  const descriptor = useMemo(
    () =>
      buildDetailsQueryDescriptor({
        ledgerId,
        ...(bookId == null ? {} : { bookId }),
        periodParams,
        advancedFilters,
        ...(timeZone !== undefined ? { timeZone } : {}),
        mainCurrency,
      }),
    [advancedFilters, bookId, ledgerId, mainCurrency, periodParams, timeZone]
  );

  const summaryQuery = useQuery({
    queryKey: descriptor.summaryQueryKey,
    queryFn: () =>
      getLedgerStatsAction(ledgerId, {
        ...descriptor.summaryParams.filters,
        ...(descriptor.summaryParams.startDate != null
          ? { startDate: descriptor.summaryParams.startDate }
          : {}),
        ...(descriptor.summaryParams.endDate != null
          ? { endDate: descriptor.summaryParams.endDate }
          : {}),
      }),
    enabled: true,
    staleTime: QUERY.DEFAULT_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });
  const { data: summaryData } = summaryQuery;

  const entriesQuery = useInfiniteQuery({
    queryKey: descriptor.entriesQueryKey,
    queryFn: ({ pageParam }) =>
      getLedgerEntriesAction(ledgerId, descriptor.getEntriesInput(pageParam as string | undefined)),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined as string | undefined,
    staleTime: QUERY.DEFAULT_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = entriesQuery;

  const entries = useMemo(() => {
    if (!data?.pages) return [];
    const allItems = data.pages.flatMap((page) => page.items);
    const uniqueMap = new Map<string, LedgerEntry>();
    allItems.forEach((item) => uniqueMap.set(item.id, item));
    return Array.from(uniqueMap.values());
  }, [data]);

  const monthStats = useMemo(() => {
    const totals = summaryData?.totals ?? [];
    const convertedTotal = summaryData?.convertedTotal;
    const mainTotal = convertedTotal?.total ?? null;
    const hasMultipleCurrencies = totals.length > 1;

    return {
      mainTotal,
      mainCurrency: convertedTotal?.currency ?? mainCurrency,
      unconvertedCount: summaryData?.unconvertedCount ?? 0,
      hasMultipleCurrencies,
      breakdown: totals,
    };
  }, [summaryData, mainCurrency]);

  const queryStatus =
    entriesQuery.status === "error" || summaryQuery.status === "error"
      ? "error"
      : entriesQuery.status === "pending" || summaryQuery.status === "pending"
        ? "pending"
        : "success";
  const queryIsFetching = entriesQuery.isFetching || summaryQuery.isFetching;
  const queryHasData = entriesQuery.data !== undefined || summaryQuery.data !== undefined;

  return {
    entries,
    summaryData,
    isLoading,
    isFetchingNextPage,
    isFetchNextPageError: entriesQuery.isFetchNextPageError,
    hasNextPage,
    fetchNextPage,
    monthStats,
    filterKey: descriptor.filterKey,
    startDateStr: descriptor.startDateStr,
    endDateStr: descriptor.endDateStr,
    queryKey: descriptor.entriesQueryKey,
    queryStatus,
    queryIsFetching,
    queryHasData,
  };
}
