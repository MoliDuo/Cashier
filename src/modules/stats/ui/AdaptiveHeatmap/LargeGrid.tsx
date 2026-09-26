/**
 * Large Grid Heatmap (<= 35 days)
 * A month at a glance: one week per row, Monday first.
 */

"use client";
import { useMemo } from "react";
import { textRoleClassName } from "@/components/typography";
import { cn } from "@/lib/utils";
import { parseDateString } from "@/lib/date-utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getHeatmapLevel } from "../../lib/heatmap-colors";
import { generateHeatmapDateKeys, resolveHeatmapRange } from "../../lib/heatmap-range";
import type { CalendarDayData, CalendarHeatmapStats } from "../../types";
import { DayCellLarge } from "./DayCellLarge";
import { calendarCopy } from "@/copy/controls";

interface LargeGridHeatmapProps {
  days: CalendarDayData[];
  stats: CalendarHeatmapStats;
  onDayClick?: (date: string) => void;
  className?: string;
  queryRange?: { startDate: string; endDate: string };
  currency: string;
  locale: string;
}

export function LargeGridHeatmap({
  days,
  stats,
  onDayClick,
  className,
  queryRange,
  currency,
  locale,
}: LargeGridHeatmapProps) {
  // The key is spelled out rather than built, so the catalogue check can see it.
  const weekdayNames = calendarCopy.weekDaysMon;

  // Create a map for quick lookup
  const dayMap = useMemo(() => {
    const map = new Map<string, CalendarDayData>();
    days.forEach((day) => {
      map.set(day.date, day);
    });
    return map;
  }, [days]);

  // Generate continuous grid from query start to max(latest data, today)
  const gridDays = useMemo(() => {
    return generateHeatmapDateKeys(resolveHeatmapRange(days, queryRange)).map((date) => {
      const dayData = dayMap.get(date);
      return dayData != null ? { date, dayData } : { date };
    });
  }, [days, dayMap, queryRange]);

  // Empty leading cells align the first day with the Monday-first week layout.
  const leadingEmptyCells = useMemo(() => {
    const range = resolveHeatmapRange(days, queryRange);
    if (range == null) return 0;
    const dayOfWeek = parseDateString(range.startDate).getDay(); // 0 = Sunday
    return (dayOfWeek + 6) % 7;
  }, [days, queryRange]);

  return (
    <div className={cn("flex w-full justify-center", className)}>
      <TooltipProvider>
        {/*
         * The grid is capped rather than stretched. Seven columns across a
         * desktop container gave cells the size of a playing card with a 12px
         * figure floating in the middle, and pushed the ranking off the screen
         * entirely. A calendar reads as a calendar at about sixty pixels.
         */}
        <div className="grid w-full min-w-0 max-w-[27rem] grid-cols-7 gap-1.5 sm:gap-2">
          {weekdayNames.map((name) => (
            <span
              key={name}
              aria-hidden="true"
              className={textRoleClassName("micro", "pb-0.5 text-center")}
            >
              {name}
            </span>
          ))}
          {Array.from({ length: leadingEmptyCells }, (_, index) => (
            <div
              key={`offset-${index}`}
              aria-hidden="true"
              className="aspect-square w-full min-w-0"
            />
          ))}
          {gridDays.map(({ date, dayData }) => {
            const amount = dayData?.totalAmount ?? "0";
            const level = getHeatmapLevel(amount, stats);
            const [, , dayPart] = date.split("-");
            const dayNumber = Number.parseInt(dayPart ?? "1", 10);

            return (
              <DayCellLarge
                key={date}
                date={date}
                dayNumber={dayNumber}
                amount={amount}
                count={dayData?.entryCount ?? 0}
                level={level}
                currency={currency}
                locale={locale}
                onClick={() => onDayClick?.(date)}
              />
            );
          })}
        </div>
      </TooltipProvider>
    </div>
  );
}
