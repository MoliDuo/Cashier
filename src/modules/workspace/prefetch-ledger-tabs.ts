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
import type { MemberProfileContract } from "@/application/contracts";

/**
 * The signed-in member's own zone, hydrated alongside the ledger. Prefetching
 * uses the same zone the tab will, so a prefetched page is not a different day
 * from the one it lands in.
 */
function memberTimeZone(queryClient: QueryClient, ledgerId: string, userId: string) {
  const members = queryClient.getQueryData<readonly MemberProfileContract[]>(
    queryKeys.coupleMembers(ledgerId)
  );
  return members?.find((member) => member.id === userId)?.timeZone ?? runtimeEnv.timeZone;
}
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
  userId: string,
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
    timeZone: memberTimeZone(queryClient, ledgerId, userId),
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
  userId: string,
  statsState: StatsUrlState = { range: "month", offset: 0, view: "heatmap" }
) {
  const { getEnhancedStats } = await import("@/lib/queries/ledger-query-client");
  const ledger = queryClient.getQueryData<Ledger>(queryKeys.ledger(ledgerId));
  const mainCurrency = ledger?.settings.mainCurrency ?? "CNY";
  const fixedTimeZone = memberTimeZone(queryClient, ledgerId, userId);
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
