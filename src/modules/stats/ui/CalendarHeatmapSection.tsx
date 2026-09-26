/**
 * Calendar Heatmap Section
 *
 * Pure heatmap visualization for StatsTab.
 * Shows spending intensity over time with adaptive display:
 * - Small range: Large grid cells with date/amount
 * - Large range: Small GitHub-style cells with horizontal scroll
 *
 * No calendar features - just a pure heatmap.
 */

"use client";
import { useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { AdaptiveHeatmap } from "./AdaptiveHeatmap";
import { getHeatmapLegend } from "../lib/heatmap-colors";
import type { CalendarDayData, CalendarHeatmapStats } from "../types";
import { calendarCopy } from "@/copy/controls";

interface CalendarHeatmapSectionProps {
  days: CalendarDayData[];
  stats: CalendarHeatmapStats;
  onDateDrilldown?: (date: string) => void;
  className?: string;
  currency?: string;
  locale?: string;
  /**
   * Query range for the heatmap display.
   * If not provided, falls back to data-driven range.
   */
  queryRange?: {
    startDate: string;
    endDate: string;
  };
}

export function CalendarHeatmapSection({
  days,
  stats,
  onDateDrilldown,
  className,
  queryRange,
  currency = "CNY",
  locale = "zh-CN",
}: CalendarHeatmapSectionProps) {
  const heatmapLevelLabel = (level: number) => {
    switch (level) {
      case 0:
        return calendarCopy.heatmapLevel0;
      case 1:
        return calendarCopy.heatmapLevel1;
      case 2:
        return calendarCopy.heatmapLevel2;
      case 3:
        return calendarCopy.heatmapLevel3;
      case 4:
        return calendarCopy.heatmapLevel4;
      case 5:
        return calendarCopy.heatmapLevel5;
      default:
        return calendarCopy.heatmapLevel0;
    }
  };

  // Handle day click
  const handleDayClick = useCallback(
    (date: string) => {
      if (onDateDrilldown) {
        onDateDrilldown(date);
      }
    },
    [onDateDrilldown]
  );

  // Legend items
  const legend = useMemo(() => getHeatmapLegend(), []);

  // No data state
  if (days.length === 0 && queryRange == null) {
    return (
      <div
        className={cn(
          "h-[200px] flex items-center justify-center text-muted-foreground text-sm bg-surface rounded-lg",
          className
        )}
      >
        {calendarCopy.noData}
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Heatmap grid */}
      <AdaptiveHeatmap
        days={days}
        stats={stats}
        onDayClick={handleDayClick}
        currency={currency}
        locale={locale}
        {...(queryRange !== undefined ? { queryRange } : {})}
      />

      {/* Legend */}
      <div className="flex items-center justify-center gap-2 pt-2">
        <span className="text-xs text-muted-foreground">{calendarCopy.less}</span>
        <div className="flex gap-1">
          {legend.map((item) => (
            <div
              key={item.level}
              role="img"
              className="w-4 h-4 rounded-sm"
              style={{ backgroundColor: item.color }}
              aria-label={heatmapLevelLabel(item.level)}
              title={heatmapLevelLabel(item.level)}
            />
          ))}
        </div>
        <span className="text-xs text-muted-foreground">{calendarCopy.more}</span>
      </div>
    </div>
  );
}
