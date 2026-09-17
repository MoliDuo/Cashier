"use client";

import type { QueryClient } from "@tanstack/react-query";
import { QUERY } from "@/lib/constants";
import { queryKeys } from "@/lib/query-keys";
import type { PeriodParams } from "@/lib/period-utils";
import type { Ledger } from "@/modules/ledger/contracts";
import type { LedgerAdvancedFilters } from "./initial-query-state";
import { addPeriod, getDateInTimezone, parseDateString } from "@/lib/date-utils";
import { runtimeEnv } from "@/lib/env/runtime";
import type { StatsUrlState } from "./ledger-url-params";
import {
  buildDetailsQueryDescriptor,
  buildStatsQueryDescriptor,
} from "./ledger-tab-query-descriptors";

type LedgerEntriesPage = Awaited<
  ReturnType<(typeof import("@/lib/queries/ledger-query-client"))["getLedgerEntriesAction"]>
>;

export async function prefetchDetailsTabQuery(
  queryClient: QueryClient,
  ledgerId: string,
  periodParams: PeriodParams,
  advancedFilters: LedgerAdvancedFilters,
  attributedUserId?: string
) {
  const { getLedgerEntriesAction, getLedgerStatsAction } =
    await import("@/lib/queries/ledger-query-client");
  const ledger = queryClient.getQueryData<Ledger>(queryKeys.ledger(ledgerId));
  const mainCurrency = ledger?.settings.mainCurrency ?? "CNY";
  const descriptor = buildDetailsQueryDescriptor({
    ledgerId,
    ...(attributedUserId == null ? {} : { attributedUserId }),
    periodParams,
    advancedFilters,
    ...(ledger?.settings.timeZone != null ? { timeZone: ledger.settings.timeZone } : {}),
    mainCurrency,
  });

  await Promise.all([
    queryClient.prefetchQuery({
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
      staleTime: QUERY.DEFAULT_STALE_TIME_MS,
    }),
    queryClient.prefetchInfiniteQuery({
      queryKey: descriptor.entriesQueryKey,
      queryFn: ({ pageParam }) =>
        getLedgerEntriesAction(ledgerId, descriptor.getEntriesInput(pageParam)),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage: LedgerEntriesPage) => lastPage.nextCursor,
      staleTime: QUERY.DEFAULT_STALE_TIME_MS,
    }),
  ]);
}

export async function prefetchStatsTabQuery(
  queryClient: QueryClient,
  ledgerId: string,
  statsState: StatsUrlState = { range: "month", offset: 0, view: "heatmap" }
) {
  const { getEnhancedStats } = await import("@/lib/queries/ledger-query-client");
  const ledger = queryClient.getQueryData<Ledger>(queryKeys.ledger(ledgerId));
  const mainCurrency = ledger?.settings.mainCurrency ?? "CNY";
  const fixedTimeZone = ledger?.settings.timeZone ?? runtimeEnv.timeZone;
  const zonedToday = getDateInTimezone(fixedTimeZone);
  const initialDate = zonedToday != null ? parseDateString(zonedToday) : new Date();
  const descriptor = buildStatsQueryDescriptor({
    ledgerId,
    currentDate: addPeriod(initialDate, statsState.range, statsState.offset),
    mainCurrency,
    rangeType: statsState.range,
    currentPeriod: statsState.offset === 0,
  });

  await queryClient.prefetchQuery({
    queryKey: descriptor.queryKey,
    queryFn: () => getEnhancedStats(descriptor.input),
    staleTime: QUERY.DEFAULT_STALE_TIME_MS,
  });
}
