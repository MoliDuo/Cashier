"use client";

import { useMemo } from "react";
import { BarChart3, Grid3X3 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { DateRangeType } from "@/lib/date-utils";
import type { EnhancedStatsDto } from "@/modules/stats/contracts";
import { deriveStatsInsights } from "@/modules/stats/lib/derived-insights";
import { CalendarHeatmapSection } from "./CalendarHeatmapSection";
import { StatsChart } from "./StatsChart";
import { StatsHighlights } from "./StatsHighlights";
import { StatsPanel } from "./StatsPanel";
import { StatsPeriodBar } from "./StatsPeriodBar";
import { StatsRanking } from "./StatsRanking";
import { StatsSummary } from "./StatsSummary";
import { StatsWeekdayRhythm } from "./StatsWeekdayRhythm";
import { DISPLAY_LOCALE } from "@/lib/constants";

interface StatsContentViewProps {
  rangeType: DateRangeType;
  contentRangeType: DateRangeType;
  onRangeTypeChange: (rangeType: DateRangeType) => void;
  periodOffset: number;
  onPeriodOffsetChange: (offset: number) => void;
  label: string;
  startDate: Date;
  endDate: Date;
  startDateStr: string;
  endDateStr: string;
  stats: EnhancedStatsDto | undefined;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  chartView: "trend" | "heatmap";
  onChartViewChange: (view: "trend" | "heatmap") => void;
  fallbackCurrency?: string;
  onCategoryDrilldown?: (categoryId: string, startDate: string, endDate: string) => void;
  onDateDrilldown?: (date: string) => void;
  readOnly?: boolean;
}

export function StatsContentView({
  rangeType,
  contentRangeType,
  onRangeTypeChange,
  periodOffset,
  onPeriodOffsetChange,
  label,
  startDate,
  endDate,
  startDateStr,
  endDateStr,
  stats,
  isLoading = false,
  isError = false,
  onRetry,
  chartView,
  onChartViewChange,
  fallbackCurrency = "CNY",
  onCategoryDrilldown,
  onDateDrilldown,
  readOnly = false,
}: StatsContentViewProps) {
  const t = useTranslations("StatsTab");
  const tCommon = useTranslations("Common");
  const locale = DISPLAY_LOCALE;
  const currencySymbol = stats?.summary.currency ?? fallbackCurrency;
  const periodLabel =
    contentRangeType === "week"
      ? t("lastWeek")
      : contentRangeType === "month"
        ? t("lastMonth")
        : t("lastYear");

  // Derived once here rather than in each panel: they are all reading the same
  // payload, and three copies of the walk would be three chances to disagree.
  const insights = useMemo(
    () =>
      stats == null
        ? null
        : deriveStatsInsights(stats, { startDate: startDateStr, endDate: endDateStr }),
    [endDateStr, startDateStr, stats]
  );

  if (isError && stats == null) {
    return (
      <div className="space-y-6 pb-24">
        <div
          role="alert"
          className="flex flex-col items-center gap-3 rounded-lg border border-danger/30 bg-danger/5 px-4 py-8 text-center"
        >
          <p className="text-sm text-foreground">{t("loadFailed")}</p>
          {onRetry != null ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              {t("retry")}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const viewSwitch = (
    <div className="flex items-center gap-1">
      <Button
        variant={chartView === "heatmap" ? "default" : "ghost"}
        size="sm"
        onClick={() => onChartViewChange("heatmap")}
        disabled={readOnly}
        aria-pressed={chartView === "heatmap"}
        className="h-7 px-2"
      >
        <Grid3X3 aria-hidden="true" className="mr-1 h-4 w-4" />
        {t("heatmap")}
      </Button>
      <Button
        variant={chartView === "trend" ? "default" : "ghost"}
        size="sm"
        onClick={() => onChartViewChange("trend")}
        disabled={readOnly}
        aria-pressed={chartView === "trend"}
        className="h-7 px-2"
      >
        <BarChart3 aria-hidden="true" className="mr-1 h-4 w-4" />
        {t("trend")}
      </Button>
    </div>
  );

  return (
    <div className="relative space-y-6 pb-24" aria-busy={isLoading}>
      {isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm"
        >
          <span className="text-danger">{t("loadFailed")}</span>
          {onRetry != null ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              {t("retry")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <StatsPeriodBar
        rangeType={rangeType}
        setRangeType={onRangeTypeChange}
        periodOffset={periodOffset}
        setPeriodOffset={onPeriodOffsetChange}
        label={label}
        readOnly={readOnly}
      />

      <StatsSummary
        total={stats?.summary.total ?? "0"}
        dailyAverage={stats?.summary.dailyAverage ?? "0"}
        currencySymbol={currencySymbol}
        comparison={stats?.summary.comparison}
        periodLabel={periodLabel}
        insights={
          insights ?? {
            entryCount: 0,
            averageEntry: null,
            activeDays: 0,
            periodDays: 0,
            busiestDay: null,
            longestStreak: 0,
            weekdayAverages: [],
            topMover: null,
          }
        }
        chart={stats?.chart ?? []}
        previousChart={stats?.previousChart ?? []}
        onExpandTrend={chartView === "trend" ? undefined : () => onChartViewChange("trend")}
        readOnly={readOnly}
        isLoading={isLoading && stats == null}
      />

      {stats?.unconvertedCount != null && stats.unconvertedCount > 0 ? (
        <div
          role="status"
          className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
        >
          {tCommon("incompleteAccountingProjection")}
        </div>
      ) : null}

      {/*
       * Two columns from lg. Below that the heatmap column would be narrower
       * than the phone layout it is already tuned for, which is the worst of
       * both; above it there is room for the ranking to sit beside the calendar
       * instead of below the fold.
       */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
        <div className="min-w-0 lg:col-span-7">
          <StatsPanel
            title={chartView === "trend" ? t("expenseTrend") : t("dailyHeatmap")}
            actions={viewSwitch}
          >
            {stats == null ? (
              <div
                className="h-64 animate-pulse rounded-lg border border-border bg-surface2/60"
                data-testid="stats-visualization-skeleton"
                role="status"
                aria-busy="true"
              />
            ) : chartView === "trend" ? (
              <StatsChart
                data={stats.chart}
                previousData={stats.previousChart}
                dailyAverage={stats.summary.dailyAverage}
                rangeType={contentRangeType}
                startDate={startDate}
                endDate={endDate}
                isLoading={isLoading && stats == null}
                currencySymbol={currencySymbol}
              />
            ) : (
              <CalendarHeatmapSection
                days={stats.heatmap.days}
                stats={stats.heatmap.stats}
                {...(onDateDrilldown !== undefined ? { onDateDrilldown } : {})}
                currency={currencySymbol}
                locale={locale}
                queryRange={{ startDate: startDateStr, endDate: endDateStr }}
              />
            )}
          </StatsPanel>
        </div>

        <div className="min-w-0 space-y-6 lg:col-span-5">
          <StatsRanking
            data={stats?.categories ?? []}
            isLoading={isLoading && stats == null}
            currencySymbol={currencySymbol}
            {...(onCategoryDrilldown !== undefined
              ? {
                  onCategoryClick: (categoryId: string) =>
                    onCategoryDrilldown(categoryId, startDateStr, endDateStr),
                }
              : {})}
          />

          {insights != null ? (
            <StatsHighlights
              insights={insights}
              currencySymbol={currencySymbol}
              periodLabel={periodLabel}
              {...(onDateDrilldown !== undefined ? { onDateDrilldown } : {})}
            />
          ) : null}

          {insights != null && contentRangeType !== "week" ? (
            <StatsWeekdayRhythm
              weekdayAverages={insights.weekdayAverages}
              currencySymbol={currencySymbol}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
