"use client";

import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LedgerQueryErrorBanner } from "./LedgerQueryErrorBanner";
import type { EntryCategory, Ledger, LedgerEntry } from "@/modules/ledger/contracts";
import type { EntryFilters } from "@/modules/ledger/ui/EntryFilterPanel";
import type { PeriodParams } from "@/lib/period-utils";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { useDetailsTabData } from "@/modules/ledger/hooks/useDetailsTabData";
import { useDetailsTabGrouping } from "@/modules/ledger/hooks/useDetailsTabGrouping";
import { useDetailsTabFilters } from "./useDetailsTabFilters";
import { useDetailsBatchController } from "./useDetailsBatchController";
import { DetailsTabView } from "./DetailsTabView";
import { openLedgerEntrySourceDocument } from "@/lib/navigation/ledger-detail-navigation";

interface DetailsTabProps {
  ledgerId: string;
  categories: EntryCategory[];
  ledger?: Ledger;
  periodParams: PeriodParams;
  onFiltersChange: (filters: EntryFilters) => void;
  advancedFilters: {
    categoryId?: string | null;
    currency?: string | null;
    minAmount?: string | null;
    maxAmount?: string | null;
    search?: string | null;
  };
  timeZone?: string;
  onRefresh?: (() => Promise<unknown> | unknown) | undefined;
  isRefreshing?: boolean | undefined;
}

export function DetailsTab({
  ledgerId,
  categories,
  ledger,
  periodParams,
  onFiltersChange,
  advancedFilters,
  timeZone,
  onRefresh,
  isRefreshing,
}: DetailsTabProps) {
  const data = useDetailsTabData({
    ledgerId,
    periodParams,
    advancedFilters,
    ...(timeZone != null ? { timeZone } : {}),
    ...(ledger !== undefined ? { ledger } : {}),
  });
  const queryClient = useQueryClient();
  const retry = () => {
    void queryClient.refetchQueries({
      type: "active",
      predicate: ({ queryKey: key }) =>
        key[0] === "ledger" &&
        key[1] === ledgerId &&
        (key[2] === "entries" || key[2] === "summary"),
    });
  };
  const { groupedItems } = useDetailsTabGrouping(data.entries, timeZone);
  const queryFingerprint = useMemo(
    () =>
      JSON.stringify({
        tab: "details",
        period: periodParams,
        filters: advancedFilters,
      }),
    [advancedFilters, periodParams]
  );
  const batch = useDetailsBatchController(
    ledgerId,
    data.entries,
    queryFingerprint,
    timeZone,
    categories
  );
  const { filters } = useDetailsTabFilters({
    periodParams,
    advancedFilters,
    ...(timeZone != null ? { timeZone } : {}),
  });
  const sentinelRef = useInfiniteScroll({
    hasNextPage: data.hasNextPage,
    isFetchingNextPage: data.isFetchingNextPage,
    isFetchNextPageError: data.isFetchNextPageError,
    fetchNextPage: data.fetchNextPage,
  });
  // An entry has no detail sheet of its own — opening one lands on the record
  // it belongs to, the same sheet the stream card opens.
  const handleViewEntry = useCallback(
    (entry: LedgerEntry) => openLedgerEntrySourceDocument(entry),
    []
  );
  return (
    <>
      {data.queryStatus === "error" && (
        <LedgerQueryErrorBanner empty={!data.queryHasData} onRetry={retry} />
      )}
      {(data.queryStatus !== "error" || data.queryHasData) && (
        <DetailsTabView
          categories={categories}
          {...(ledger === undefined ? {} : { ledger })}
          periodParams={periodParams}
          filters={filters}
          advancedFilters={advancedFilters}
          onFiltersChange={onFiltersChange}
          entries={data.entries}
          groupedItems={groupedItems}
          isLoading={data.isLoading}
          isFetchingNextPage={data.isFetchingNextPage}
          isFetchNextPageError={data.isFetchNextPageError}
          onRetryNextPage={() => void data.fetchNextPage()}
          hasNextPage={data.hasNextPage}
          monthStats={data.monthStats}
          sentinelRef={sentinelRef}
          batch={batch}
          onViewEntry={handleViewEntry}
          onRefresh={onRefresh}
          isRefreshing={isRefreshing}
        />
      )}
    </>
  );
}
