"use client";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSourceDocumentStream } from "@/modules/source-document/hooks/useSourceDocumentStream";
import { fetchStreamTotal } from "@/modules/source-document/queries";
import { buildStreamQueryDescriptor } from "@/modules/workspace/ledger-tab-query-descriptors";
import type { EntryFilters } from "@/modules/ledger/ui/EntryFilterPanel";

interface UseLedgerEntriesStreamDataOptions {
  bookId?: string;
  mainCurrency: string;
  filters: EntryFilters;
  startDateStr: string | undefined;
  endDateStr: string | undefined;
}

/**
 * Owns the unified source-document stream query, its auxiliary totals query,
 * and the tab's combined error state.
 */
export function useLedgerEntriesStreamData({
  bookId,
  mainCurrency,
  filters,
  startDateStr,
  endDateStr,
}: UseLedgerEntriesStreamDataOptions) {
  const streamQueryDescriptor = useMemo(
    () =>
      buildStreamQueryDescriptor({
        ...(bookId == null ? {} : { bookId }),
        startDate: startDateStr,
        endDate: endDateStr,
        minAmount: filters.minAmount,
        maxAmount: filters.maxAmount,
        statuses: filters.statuses,
        search: filters.search,
      }),
    [
      bookId,
      endDateStr,
      filters.maxAmount,
      filters.minAmount,
      filters.search,
      filters.statuses,
      startDateStr,
    ]
  );
  const streamTotalQuery = useQuery({
    queryKey: streamQueryDescriptor.totalQueryKey,
    queryFn: () => fetchStreamTotal(streamQueryDescriptor.totalInput),
  });
  const { data: streamTotalData } = streamTotalQuery;
  const filteredTotal = streamTotalData?.total;

  // Use the unified stream hook with paginated all-statuses results
  const {
    streamGroups,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    queryStatus,
    refetch,
    queryHasData,
  } = useSourceDocumentStream({
    mainCurrency,
    queryDescriptor: streamQueryDescriptor,
  });

  return {
    isError: queryStatus === "error" || streamTotalQuery.isError,
    hasData: queryHasData,
    retry: () => {
      void refetch();
      void streamTotalQuery.refetch();
    },
    streamGroups,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    streamTotalData,
    filteredTotal,
  };
}
