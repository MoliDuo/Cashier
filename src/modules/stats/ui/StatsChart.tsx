"use client";
import { useMemo, useState } from "react";
import {
  type DateRangeType,
  formatDateTimeForApi,
  formatRelativeDateLabel,
} from "@/lib/date-utils";
import { useTranslations } from "next-intl";
import { formatCompactCurrencyAmount, formatCurrencyAmount } from "@/lib/format/currency";
import { buildChartPoints } from "@/modules/stats/lib/chart-points";
import { DISPLAY_LOCALE } from "@/lib/constants";

interface StatsChartProps {
  data: { date: string; total: string }[];
  /** The comparison window's daily totals, read off against `data` by position. */
  previousData?: { date: string; total: string }[];
  dailyAverage?: string;
  rangeType: DateRangeType;
  startDate: Date;
  endDate: Date;
  isLoading?: boolean;
  currencySymbol?: string;
}

export function StatsChart({
  data = [],
  previousData = [],
  dailyAverage = "0",
  rangeType,
  startDate,
  endDate,
  isLoading,
  currencySymbol = "CNY",
}: StatsChartProps) {
  const locale = DISPLAY_LOCALE;
  const t = useTranslations("StatsChart");
  const tTab = useTranslations("StatsTab");
  const tCommon = useTranslations("Common");
  // The queried range is already truncated to the ledger-timezone today by the
  // stats state; do not re-clamp with the browser clock here.
  const chartPoints = useMemo(() => {
    if (isLoading) return [];
    return buildChartPoints({
      data,
      rangeType,
      startDate: formatDateTimeForApi(startDate)!,
      endDate: formatDateTimeForApi(endDate)!,
      locale,
    });
  }, [data, endDate, isLoading, locale, rangeType, startDate]);
  // The comparison window covers different dates, so it is lined up against
  // this one by position — its first day under this period's first day — and
  // cut where this period ends rather than stretched across it.
  const previousValues = useMemo(() => {
    if (isLoading || previousData.length === 0) return [];
    return buildChartPoints({
      data: previousData,
      rangeType,
      startDate: previousData[0]!.date,
      endDate: previousData[previousData.length - 1]!.date,
      locale,
    }).map((point) => point.value);
  }, [isLoading, locale, previousData, rangeType]);
  const [hoveredPoint, setHoveredPoint] = useState<{
    index: number;
    dataset: typeof chartPoints;
  } | null>(null);

  // 计算95th percentile作为Y轴显示上限，处理异常值
  const { yAxisMax, hasOutliers } = useMemo(() => {
    if (chartPoints.length === 0) return { yAxisMax: 1, hasOutliers: false };

    const values = [...chartPoints.map((p) => p.value), ...previousValues];
    const maxVal = Math.max(...values, 1);

    // 数据点少于10个时，使用最大值（避免过度压缩）
    if (values.length < 10) {
      return { yAxisMax: maxVal, hasOutliers: false };
    }

    // 计算95th percentile
    const sorted = [...values].sort((a, b) => a - b);
    const p95Index = Math.ceil(sorted.length * 0.95) - 1;
    const p95Value = sorted[p95Index] ?? maxVal;

    // 如果95th percentile与最大值差距不大（<20%），直接使用最大值
    if (maxVal - p95Value < maxVal * 0.2) {
      return { yAxisMax: maxVal, hasOutliers: false };
    }

    // 确保封顶线至少是最大值的20%（避免过度拉伸）
    const yAxisMax = Math.max(p95Value, maxVal * 0.2);
    return { yAxisMax, hasOutliers: true };
  }, [chartPoints, previousValues]);

  if (isLoading) {
    return (
      <div
        className="h-48 w-full animate-pulse rounded-lg bg-surface2/30"
        role="status"
        aria-busy="true"
      />
    );
  }

  if (chartPoints.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface px-4 py-8 text-center text-sm text-muted-foreground">
        {t("noData")}
      </div>
    );
  }

  // Calculate chart dimensions (chart area height)
  const chartHeight = 130; // pixels, matches h-full minus padding
  const paddingTop = 10; // 10% top padding
  const paddingBottom = 10; // 10% bottom padding
  const formatAmount = (value: string) => formatCurrencyAmount(value, currencySymbol, locale);
  const formatAxisAmount = (value: number) =>
    formatCompactCurrencyAmount(value, currencySymbol, locale);
  const yAxisMin = Math.min(0, ...chartPoints.map((point) => point.value));
  const yAxisRange = yAxisMax - yAxisMin;
  const averageValue = Number(dailyAverage);
  const averageOffset =
    Number.isFinite(averageValue) && averageValue > yAxisMin && averageValue < yAxisMax
      ? paddingTop +
        (1 - (averageValue - yAxisMin) / yAxisRange) * (100 - paddingTop - paddingBottom)
      : null;
  const yAxisTicks = [
    yAxisMax,
    yAxisMin + (yAxisRange * 2) / 3,
    yAxisMin + yAxisRange / 3,
    yAxisMin,
  ];

  return (
    <div className="w-full h-52 relative pt-6 pb-6 select-none">
      {/* Legend for the comparison line, which is otherwise an unexplained dash. */}
      {previousValues.length > 1 ? (
        <div className="absolute left-12 top-0 flex items-center gap-1.5 text-micro text-muted-foreground">
          <span aria-hidden="true" className="h-px w-4 border-t border-dashed border-current" />
          {tTab("sparklinePrevious")}
        </div>
      ) : null}
      {/* Outlier indicator */}
      {hasOutliers && (
        <div className="absolute top-0 right-2 text-micro text-muted-foreground bg-surface2/50 px-2 py-0.5 rounded-full">
          {t("scaleAdjusted")}
        </div>
      )}
      {/* The period's own daily average, so a point reads as above or below par. */}
      {averageOffset != null ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-12 right-2"
          style={{ top: `calc(1.5rem + ${chartHeight}px * ${averageOffset / 100})` }}
        >
          <div className="border-t border-dashed border-primary/50" />
          <span className="absolute right-0 -top-4 rounded bg-surface px-1 text-micro text-primary">
            {tTab("dailyAverageLine")}
          </span>
        </div>
      ) : null}

      {/* Grid Lines */}
      <div className="pointer-events-none absolute bottom-8 left-12 right-2 top-6 flex flex-col justify-between">
        {yAxisTicks.map((tick) => (
          <div key={tick} className="relative h-px w-full border-b border-dashed border-border/40">
            <span className="absolute right-full -translate-y-1/2 pr-2 text-micro tabular-nums text-muted-foreground">
              {formatAxisAmount(tick)}
            </span>
          </div>
        ))}
      </div>

      {/* Chart Area - Using relative positioning for points */}
      <div className="absolute left-12 right-2 top-6" style={{ height: `${chartHeight}px` }}>
        {/* SVG for line only - stretched horizontally */}
        <svg
          role="img"
          aria-label={tTab("expenseTrend")}
          className="absolute inset-0 w-full h-full overflow-visible"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {/* Last period, for scale: the same days one period back. */}
          {previousValues.length > 1 && (
            <polyline
              points={previousValues
                .map((value, index) => {
                  const xPercent =
                    previousValues.length === 1 ? 50 : (index / (previousValues.length - 1)) * 100;
                  const displayValue = Math.min(value, yAxisMax);
                  const yPercent =
                    paddingTop +
                    (1 - (displayValue - yAxisMin) / yAxisRange) *
                      (100 - paddingTop - paddingBottom);
                  return `${xPercent},${yPercent}`;
                })
                .join(" ")}
              fill="none"
              stroke="var(--chart-5)"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              opacity="0.55"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Line Path */}
          {chartPoints.length > 1 && (
            <polyline
              points={chartPoints
                .map((p, i) => {
                  const xPercent =
                    chartPoints.length === 1 ? 50 : (i / (chartPoints.length - 1)) * 100;
                  // Calculate y position (inverted: 0 at top) using capped value
                  const displayValue = Math.min(p.value, yAxisMax);
                  const yPercent =
                    paddingTop +
                    (1 - (displayValue - yAxisMin) / yAxisRange) *
                      (100 - paddingTop - paddingBottom);
                  return `${xPercent},${yPercent}`;
                })
                .join(" ")}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-primary transition-[color,stroke] duration-[var(--motion-state)] ease-[var(--motion-state-ease)]"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* Points - Using absolute positioning with CSS (no SVG distortion) */}
        {chartPoints.map((p, i) => {
          const leftPercent = chartPoints.length === 1 ? 50 : (i / (chartPoints.length - 1)) * 100;
          // Calculate top position using capped value
          const isCapped = p.value > yAxisMax;
          const displayValue = Math.min(p.value, yAxisMax);
          const topPercent =
            paddingTop +
            (1 - (displayValue - yAxisMin) / yAxisRange) * (100 - paddingTop - paddingBottom);

          // Format display date based on range type
          const displayDate =
            rangeType === "year"
              ? p.fullDate // YYYY-MM format
              : formatRelativeDateLabel(p.fullDate, locale, {
                  today: tCommon("today"),
                  yesterday: tCommon("yesterday"),
                });

          const isHovered = hoveredPoint?.dataset === chartPoints && hoveredPoint.index === i;

          return (
            <div
              key={i}
              className="absolute"
              style={{
                left: `${leftPercent}%`,
                top: `${topPercent}%`,
              }}
            >
              {/* Data Point */}
              <button
                type="button"
                aria-label={`${displayDate}, ${t("expense")}: ${formatAmount(p.total)}`}
                aria-current={isHovered ? "true" : undefined}
                onMouseEnter={() => setHoveredPoint({ index: i, dataset: chartPoints })}
                onMouseLeave={() => setHoveredPoint(null)}
                onFocus={() => setHoveredPoint({ index: i, dataset: chartPoints })}
                onBlur={() => setHoveredPoint(null)}
                onClick={() =>
                  setHoveredPoint(isHovered ? null : { index: i, dataset: chartPoints })
                }
                className={`
                    w-[7px] h-[7px] rounded-full bg-bg -translate-x-1/2 -translate-y-1/2
                    cursor-pointer transition-[color,background-color,border-color,opacity] duration-[var(--motion-feedback)]
                    ${
                      isCapped
                        ? 'border-2 border-danger after:content-["↑"] after:absolute after:-top-4 after:left-1/2 after:-translate-x-1/2 after:text-micro after:text-danger'
                        : "border-2 border-primary hover:border-primary/70"
                    }
                  `}
              />

              {/* Tooltip */}
              {isHovered && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1.5 bg-popover text-popover-foreground text-xs rounded shadow-lg border whitespace-nowrap z-tooltip pointer-events-none">
                  <div className="font-medium">{displayDate}</div>
                  <div className={isCapped ? "text-danger" : ""}>
                    {t("expense")}: {formatAmount(p.total)}
                    {isCapped && t("exceedsLimit")}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* X Axis Labels */}
      <div className="absolute bottom-0 left-12 right-2 h-6">
        {chartPoints.map((p, i) => {
          // Label Filtering
          let showLabel = false;
          if (rangeType === "week" || rangeType === "year") {
            showLabel = true;
          } else if (rangeType === "month") {
            // Show 1, 6, 11, 16, 21, 26, 31 (Every 5 days + last day?)
            if (i === 0 || i === chartPoints.length - 1 || i % 5 === 0) {
              showLabel = true;
            }
          }

          if (!showLabel) return null;

          const leftPos = chartPoints.length === 1 ? 50 : (i / (chartPoints.length - 1)) * 100;

          return (
            <div
              key={i}
              className="absolute text-micro text-muted-foreground transform -translate-x-1/2 text-center w-8"
              style={{ left: `${leftPos}%` }}
            >
              {p.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
