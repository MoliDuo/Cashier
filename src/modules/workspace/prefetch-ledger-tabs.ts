"use client";

import type { QueryClient } from "@tanstack/react-query";
import { QUERY } from "@/lib/constants";
import { queryKeys } from "@/lib/query-keys";
import type { PeriodParams } from "@/lib/period-utils";
import type { Ledger } from "@/modules/ledger/contracts";
import type { LedgerAdvancedFilters } from "./initial-query-state";
import { addPeriod, getDateInTimezone, parseDateString } from "@/lib/date-utils";
import { runtimeEnv } from "@/lib/env/runtime";
import { getDeviceTimeZone } from "@/lib/time-zone-cookie";
import type { StatsUrlState } from "./ledger-url-params";
import type { BookDto } from "@/modules/ledger/contracts";

/**
 * The zone the viewed book is read in, hydrated alongside the ledger. On 总账,
 * and for a book without a zone of its own, it is this device's zone — exactly
 * as the tab will date it; only a browser that cannot name its zone falls back
 * to the deployment's. Prefetching must use the same zone the tab will, so a
 * prefetched page is not a different day from the one it lands in.
 */
function scopeTimeZone(queryClient: QueryClient, bookId?: string) {
  const books = queryClient.getQueryData<readonly BookDto[]>(queryKeys.books());
  const book = bookId == null ? null : books?.find((row) => row.id === bookId);
  return book?.timeZone ?? getDeviceTimeZone() ?? runtimeEnv.timeZone;
}
import { fetchLedgerEntries, fetchLedgerSummary } from "@/modules/ledger/queries";
import type { LedgerEntryPageDto } from "@/modules/ledger/contracts";
import { fetchEnhancedStats } from "@/modules/stats/queries";
import {
  buildDetailsQueryDescriptor,
  buildStatsQueryDescriptor,
} from "./ledger-tab-query-descriptors";

export async function prefetchDetailsTabQuery(
  queryClient: QueryClient,
  bookId: string | undefined,
  periodParams: PeriodParams,
  advancedFilters: LedgerAdvancedFilters
) {
  const ledger = queryClient.getQueryData<Ledger>(queryKeys.ledger());
  const mainCurrency = ledger?.settings.mainCurrency ?? "CNY";
  const descriptor = buildDetailsQueryDescriptor({
    ...(bookId == null ? {} : { bookId }),
    periodParams,
    advancedFilters,
    timeZone: scopeTimeZone(queryClient, bookId),
    mainCurrency,
  });

  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: descriptor.summaryQueryKey,
      queryFn: () => fetchLedgerSummary(descriptor.summaryInput),
      staleTime: QUERY.DEFAULT_STALE_TIME_MS,
    }),
    queryClient.prefetchInfiniteQuery({
      queryKey: descriptor.entriesQueryKey,
      queryFn: ({ pageParam }) => fetchLedgerEntries(descriptor.getEntriesInput(pageParam)),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage: LedgerEntryPageDto) => lastPage.nextCursor,
      staleTime: QUERY.DEFAULT_STALE_TIME_MS,
    }),
  ]);
}

export async function prefetchStatsTabQuery(
  queryClient: QueryClient,
  bookId: string | undefined,
  statsState: StatsUrlState = { range: "month", offset: 0, view: "heatmap" }
) {
  const ledger = queryClient.getQueryData<Ledger>(queryKeys.ledger());
  const mainCurrency = ledger?.settings.mainCurrency ?? "CNY";
  const fixedTimeZone = scopeTimeZone(queryClient, bookId);
  const zonedToday = getDateInTimezone(fixedTimeZone);
  const initialDate = zonedToday != null ? parseDateString(zonedToday) : new Date();
  const descriptor = buildStatsQueryDescriptor({
    ...(bookId == null ? {} : { bookId }),
    currentDate: addPeriod(initialDate, statsState.range, statsState.offset),
    mainCurrency,
    rangeType: statsState.range,
    currentPeriod: statsState.offset === 0,
  });

  await queryClient.prefetchQuery({
    queryKey: descriptor.queryKey,
    queryFn: () => fetchEnhancedStats(descriptor.input),
    staleTime: QUERY.DEFAULT_STALE_TIME_MS,
  });
}
