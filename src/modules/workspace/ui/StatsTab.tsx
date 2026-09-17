"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { getEnhancedStats } from "@/lib/queries/ledger-query-client";
import {
  addPeriod,
  formatCivilDate,
  formatDateTimeForApi,
  getDateInTimezone,
  parseDateString,
  type DateRangeType,
} from "@/lib/date-utils";
import { StatsContentView } from "@/modules/stats/ui/StatsContentView";
import { useLocale, useTranslations } from "next-intl";
import type { Ledger } from "@/modules/ledger/contracts";
import { MAX_CHART_POINTS } from "@/modules/stats/lib/chart-points";
import { MAX_HEATMAP_DAYS } from "@/modules/stats/lib/heatmap-range";
import { QUERY } from "@/lib/constants";
import { DEFAULT_STATS_RANGE_TYPE } from "@/modules/workspace/initial-query-state";
import { buildStatsQueryDescriptor } from "@/modules/workspace/ledger-tab-query-descriptors";
import { usePathname } from "@/i18n/routing";
import {
  readStatsSearchParams,
  setStatsSearchParams,
  type StatsRange,
  type StatsView,
} from "@/modules/workspace/ledger-url-params";
import { pushLedgerUrl } from "@/modules/workspace/ledger-url-navigation";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatCurrencyAmount } from "@/lib/format/currency";
import { Button } from "@/components/ui/button";

const STATS_QUERY_DEBOUNCE_MS = 250;

interface StatsTabProps {
  recordScope?: "all" | "mine" | "partner";
  onRecordScopeChange?: (scope: "all" | "mine" | "partner") => void;
  userId: string;
  partnerUserId: string;
  ledgerId?: string;
  ledger?: Ledger;
  onCategoryDrilldown?: (categoryId: string, startDate: string, endDate: string) => void;
  onDateDrilldown?: (date: string) => void;
  ledgerToday?: string;
  timeZone?: string;
}

export function StatsTab({
  recordScope,
  onRecordScopeChange,
  userId,
  partnerUserId,
  ledgerId,
  ledger,
  onCategoryDrilldown,
  onDateDrilldown,
  ledgerToday,
  timeZone,
}: StatsTabProps) {
  const locale = useLocale();
  const tCommon = useTranslations("Common");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [localScope, setLocalScope] = useState<"all" | "mine" | "partner">("all");
  const scope = recordScope ?? localScope;
  const setScope = onRecordScopeChange ?? setLocalScope;
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
      pushLedgerUrl(pathname, params, locale, "stats");
    },
    [locale, pathname, searchParams, statsUrlState]
  );

  const statsDescriptor = useMemo(
    () =>
      buildStatsQueryDescriptor({
        ledgerId: ledgerId ?? "",
        ...(scope === "all" ? {} : { attributedUserId: scope === "mine" ? userId : partnerUserId }),
        currentDate,
        mainCurrency: ledger?.settings.mainCurrency ?? "CNY",
        rangeType,
        currentPeriod: periodOffset === 0,
      }),
    [
      currentDate,
      ledger?.settings.mainCurrency,
      ledgerId,
      partnerUserId,
      periodOffset,
      rangeType,
      scope,
      userId,
    ]
  );
  const mineDescriptor = useMemo(
    () =>
      buildStatsQueryDescriptor({
        ledgerId: ledgerId ?? "",
        currentDate,
        mainCurrency: ledger?.settings.mainCurrency ?? "CNY",
        rangeType,
        currentPeriod: periodOffset === 0,
        attributedUserId: userId,
      }),
    [currentDate, ledger?.settings.mainCurrency, ledgerId, periodOffset, rangeType, userId]
  );
  const partnerDescriptor = useMemo(
    () =>
      buildStatsQueryDescriptor({
        ledgerId: ledgerId ?? "",
        currentDate,
        mainCurrency: ledger?.settings.mainCurrency ?? "CNY",
        rangeType,
        currentPeriod: periodOffset === 0,
        attributedUserId: partnerUserId,
      }),
    [currentDate, ledger?.settings.mainCurrency, ledgerId, partnerUserId, periodOffset, rangeType]
  );
  const allDescriptor = useMemo(
    () =>
      buildStatsQueryDescriptor({
        ledgerId: ledgerId ?? "",
        currentDate,
        mainCurrency: ledger?.settings.mainCurrency ?? "CNY",
        rangeType,
        currentPeriod: periodOffset === 0,
      }),
    [currentDate, ledger?.settings.mainCurrency, ledgerId, periodOffset, rangeType]
  );
  const allQuery = useQuery({
    queryKey: allDescriptor.queryKey,
    queryFn: () => getEnhancedStats(allDescriptor.input),
    enabled: !!ledgerId,
    staleTime: QUERY.DEFAULT_STALE_TIME_MS,
  });
  const mineQuery = useQuery({
    queryKey: mineDescriptor.queryKey,
    queryFn: () => getEnhancedStats(mineDescriptor.input),
    enabled: !!ledgerId,
    staleTime: QUERY.DEFAULT_STALE_TIME_MS,
  });
  const partnerQuery = useQuery({
    queryKey: partnerDescriptor.queryKey,
    queryFn: () => getEnhancedStats(partnerDescriptor.input),
    enabled: !!ledgerId,
    staleTime: QUERY.DEFAULT_STALE_TIME_MS,
  });
  const queryDescriptor = useDebouncedValue(statsDescriptor, STATS_QUERY_DEBOUNCE_MS);
  const statsQuery = useQuery({
    queryKey: queryDescriptor.queryKey,
    queryFn: () => getEnhancedStats(queryDescriptor.input),
    enabled: ledgerId !== undefined && ledgerId !== "",
    staleTime: QUERY.DEFAULT_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });
  const [lastResolved, setLastResolved] = useState<{
    stats: NonNullable<typeof statsQuery.data>;
    descriptor: typeof queryDescriptor.state;
  } | null>(null);
  useEffect(() => {
    if (statsQuery.data === undefined) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setLastResolved({
        stats: statsQuery.data!,
        descriptor: queryDescriptor.state,
      });
    });
    return () => {
      active = false;
    };
  }, [queryDescriptor.state, statsQuery.data]);
  const stats = statsQuery.data ?? lastResolved?.stats;
  const contentDescriptor =
    statsQuery.data === undefined && lastResolved != null
      ? lastResolved.descriptor
      : queryDescriptor.state;
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
      <div className="flex flex-wrap gap-2" role="group" aria-label={tCommon("statsScope")}>
        {(["all", "mine", "partner"] as const).map((option) => (
          <Button
            key={option}
            size="sm"
            variant={scope === option ? "default" : "outline"}
            aria-pressed={scope === option}
            onClick={() => setScope(option)}
          >
            {option === "all"
              ? tCommon("allMembers")
              : option === "mine"
                ? tCommon("myRecords")
                : tCommon("partnerRecords")}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 border-b pb-3 text-sm" aria-live="polite">
        {(["mine", "partner", "all"] as const).map((kind) => {
          const result = kind === "mine" ? mineQuery : kind === "partner" ? partnerQuery : allQuery;
          return (
            <div key={kind} className="min-w-0">
              <div className="text-muted-foreground">
                {kind === "mine"
                  ? tCommon("myRecords")
                  : kind === "partner"
                    ? tCommon("partnerRecords")
                    : tCommon("combinedTotal")}
              </div>
              <div className="truncate font-semibold">
                {result.data
                  ? formatCurrencyAmount(
                      result.data.summary.total,
                      result.data.summary.currency,
                      locale
                    )
                  : result.isError
                    ? "—"
                    : "..."}
              </div>
            </div>
          );
        })}
      </div>
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
