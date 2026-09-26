"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { fetchEnhancedStats } from "@/modules/stats/queries";
import {
  addPeriod,
  formatCivilDate,
  formatDateTimeForApi,
  getDateInTimezone,
  parseDateString,
  type DateRangeType,
} from "@/lib/date-utils";
import { StatsContentView } from "@/modules/stats/ui/StatsContentView";

import type { Ledger } from "@/modules/ledger/contracts";
import { MAX_CHART_POINTS } from "@/modules/stats/lib/chart-points";
import { MAX_HEATMAP_DAYS } from "@/modules/stats/lib/heatmap-range";
import { QUERY, DISPLAY_LOCALE } from "@/lib/constants";
import { DEFAULT_STATS_RANGE_TYPE } from "@/modules/workspace/initial-query-state";
import { buildStatsQueryDescriptor } from "@/modules/workspace/ledger-tab-query-descriptors";
import { usePathname } from "next/navigation";
import {
  readStatsSearchParams,
  setStatsSearchParams,
  type StatsRange,
  type StatsView,
} from "@/modules/workspace/stats-url-params";
import { pushLedgerUrl } from "@/modules/workspace/ledger-url-navigation";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

const STATS_QUERY_DEBOUNCE_MS = 250;

interface StatsTabProps {
  /** The book the charts are narrowed to; undefined means 总账. */
  bookId?: string | undefined;
  ledger?: Ledger;
  onCategoryDrilldown?: (categoryId: string, startDate: string, endDate: string) => void;
  onDateDrilldown?: (date: string) => void;
  ledgerToday?: string;
  timeZone?: string;
}

export function StatsTab({
  bookId,
  ledger,
  onCategoryDrilldown,
  onDateDrilldown,
  ledgerToday,
  timeZone,
}: StatsTabProps) {
  const locale = DISPLAY_LOCALE;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const statsUrlState = useMemo(() => readStatsSearchParams(searchParams), [searchParams]);
  const rangeType: DateRangeType = statsUrlState.range ?? DEFAULT_STATS_RANGE_TYPE;
  const periodOffset = statsUrlState.offset;
  const [todayKey, setTodayKey] = useState(
    () => ledgerToday ?? getDateInTimezone(timeZone) ?? formatDateTimeForApi(new Date())
  );
  useEffect(() => {
    const updateToday = () => {
      setTodayKey(getDateInTimezone(timeZone) ?? formatDateTimeForApi(new Date()));
    };
    updateToday();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") updateToday();
    };
    const interval = window.setInterval(updateToday, 60_000);
    window.addEventListener("focus", updateToday);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", updateToday);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [ledgerToday, timeZone]);
  const today = useMemo(() => parseDateString(todayKey), [todayKey]);
  const currentDate = useMemo(
    () => addPeriod(today, rangeType, periodOffset),
    [periodOffset, rangeType, today]
  );
  const chartView = statsUrlState.view;
  const updateStatsUrl = useCallback(
    (update: Partial<{ range: StatsRange; offset: number; view: StatsView }>) => {
      const params = setStatsSearchParams(searchParams, {
        range: update.range ?? statsUrlState.range,
        offset: update.offset ?? statsUrlState.offset,
        view: update.view ?? statsUrlState.view,
      });
      pushLedgerUrl(pathname, params, "stats");
    },
    [pathname, searchParams, statsUrlState]
  );

  const statsDescriptor = useMemo(
    () =>
      buildStatsQueryDescriptor({
        ...(bookId == null ? {} : { bookId }),
        currentDate,
        mainCurrency: ledger?.settings.mainCurrency ?? "CNY",
        rangeType,
        currentPeriod: periodOffset === 0,
      }),
    [bookId, currentDate, ledger?.settings.mainCurrency, periodOffset, rangeType]
  );
  const queryDescriptor = useDebouncedValue(statsDescriptor, STATS_QUERY_DEBOUNCE_MS);
  // The debounce is for period changes, where the range is still being dragged
  // around. A book switch is a deliberate navigation, so it must not wait behind
  // the previous book's request: the new scope's descriptor is used at once, and
  // its key is what stops the old figures being shown meanwhile.
  const scopeDescriptor =
    queryDescriptor.input.bookId === statsDescriptor.input.bookId
      ? queryDescriptor
      : statsDescriptor;
  const statsQuery = useQuery({
    queryKey: scopeDescriptor.queryKey,
    queryFn: () => fetchEnhancedStats(scopeDescriptor.input),
    staleTime: QUERY.DEFAULT_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });
  // The last successful figures are kept while a refetch runs, but only for the
  // book they belong to: switching books must not show the previous book's
  // figures. The descriptor travels with them so the period label stays the one
  // the numbers were computed for.
  const [lastResolved, setLastResolved] = useState<{
    stats: NonNullable<typeof statsQuery.data>;
    descriptor: typeof scopeDescriptor.state;
    scope: string | null;
  } | null>(null);
  useEffect(() => {
    if (statsQuery.data === undefined) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setLastResolved({
        stats: statsQuery.data!,
        descriptor: scopeDescriptor.state,
        scope: bookId ?? null,
      });
    });
    return () => {
      active = false;
    };
  }, [bookId, scopeDescriptor.state, statsQuery.data]);
  const lastResolvedForScope = lastResolved?.scope === (bookId ?? null) ? lastResolved : null;
  const stats = statsQuery.data ?? lastResolvedForScope?.stats;
  const contentDescriptor =
    statsQuery.data === undefined && lastResolvedForScope != null
      ? lastResolvedForScope.descriptor
      : scopeDescriptor.state;
  const { isError, refetch } = statsQuery;
  const {
    startDate: contentStartDate,
    endDate: contentEndDate,
    startDateStr: contentStartDateStr,
    endDateStr: contentEndDateStr,
    rangeType: contentRangeType,
  } = contentDescriptor;
  const hasOversizedResult =
    stats != null &&
    ((contentRangeType !== "year" && stats.chart.length > MAX_CHART_POINTS) ||
      stats.heatmap.days.length > MAX_HEATMAP_DAYS);

  const contentLabel = useMemo(() => {
    switch (contentRangeType) {
      case "week":
        return `${formatCivilDate(contentStartDateStr, locale, { month: "numeric", day: "numeric" })} - ${formatCivilDate(contentEndDateStr, locale, { month: "numeric", day: "numeric" })}`;
      case "month":
        return formatCivilDate(contentStartDateStr, locale, { year: "numeric", month: "long" });
      case "year":
        return formatCivilDate(contentStartDateStr, locale, { year: "numeric" });
      default:
        return "";
    }
  }, [contentEndDateStr, contentRangeType, contentStartDateStr, locale]);

  return (
    <div className="space-y-4">
      <StatsContentView
        rangeType={rangeType}
        contentRangeType={contentRangeType}
        onRangeTypeChange={(type) => {
          updateStatsUrl({ range: type, offset: 0 });
        }}
        periodOffset={periodOffset}
        onPeriodOffsetChange={(offset) => updateStatsUrl({ offset })}
        label={contentLabel}
        startDate={contentStartDate}
        endDate={contentEndDate}
        startDateStr={contentStartDateStr}
        endDateStr={contentEndDateStr}
        stats={hasOversizedResult ? undefined : stats}
        isLoading={statsQuery.isFetching}
        isError={isError || hasOversizedResult}
        onRetry={() => void refetch()}
        chartView={chartView}
        onChartViewChange={(view) => updateStatsUrl({ view })}
        fallbackCurrency={ledger?.settings.mainCurrency ?? "CNY"}
        {...(onCategoryDrilldown !== undefined ? { onCategoryDrilldown } : {})}
        {...(onDateDrilldown !== undefined ? { onDateDrilldown } : {})}
      />
    </div>
  );
}
