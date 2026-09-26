/**
 * Small Grid Heatmap (> 35 days)
 * GitHub-style 12px cells with horizontal scroll
 */

"use client";
import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { formatDateTimeForApi as formatDate, parseDateString as parseDate } from "@/lib/date-utils";
import { getHeatmapLevel } from "../../lib/heatmap-colors";
import { resolveHeatmapRange } from "../../lib/heatmap-range";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { CalendarDayData, CalendarHeatmapStats } from "../../types";
import { DayCellSmall } from "./DayCellSmall";
import { statsTabCopy } from "@/copy/stats";

interface SmallGridHeatmapProps {
  days: CalendarDayData[];
  stats: CalendarHeatmapStats;
  onDayClick?: (date: string) => void;
  className?: string;
  queryRange?: { startDate: string; endDate: string };
  currency: string;
  locale: string;
}

export function SmallGridHeatmap({
  days,
  stats,
  onDayClick,
  className,
  queryRange,
  currency,
  locale,
}: SmallGridHeatmapProps) {
  // Create a map for quick lookup
  const dayMap = useMemo(() => {
    const map = new Map<string, CalendarDayData>();
    days.forEach((day) => {
      map.set(day.date, day);
    });
    return map;
  }, [days]);

  const range = useMemo(() => resolveHeatmapRange(days, queryRange), [days, queryRange]);

  // Generate weeks from query start to max(latest data, today)
  const weeks = useMemo(() => {
    if (range == null) return [];
    const startDate = range.startDate;
    const endDate = parseDate(range.endDate);

    // Find the Monday of the week containing startDate
    const start = parseDate(startDate);
    const startDayOfWeek = start.getDay(); // 0 = Sunday, 1 = Monday
    const mondayOffset = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;
    const firstMonday = new Date(start);
    firstMonday.setDate(start.getDate() - mondayOffset);

    const end = new Date(endDate);
    const endDayOfWeek = end.getDay();
    const sundayOffset = endDayOfWeek === 0 ? 0 : 7 - endDayOfWeek;
    const lastSunday = new Date(end);
    lastSunday.setDate(end.getDate() + sundayOffset);

    // Generate weeks
    const result: { weekIndex: number; days: { date: string; dayData?: CalendarDayData }[] }[] = [];
    let weekIndex = 0;
    const current = new Date(firstMonday);

    while (current <= lastSunday) {
      const weekDays: { date: string; dayData?: CalendarDayData }[] = [];

      for (let i = 0; i < 7; i++) {
        const dateStr = formatDate(current);
        const dayData = dayMap.get(dateStr);
        weekDays.push(dayData != null ? { date: dateStr, dayData } : { date: dateStr });
        current.setDate(current.getDate() + 1);
      }

      result.push({ weekIndex, days: weekDays });
      weekIndex++;
    }

    return result;
  }, [dayMap, range]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const rangeKey = `${queryRange?.startDate ?? ""}:${queryRange?.endDate ?? ""}`;
  useEffect(() => {
    const container = scrollRef.current;
    if (container == null || weeks.length === 0) return;
    const today = formatDate(new Date());
    const start = queryRange?.startDate ?? weeks[0]?.days[0]?.date ?? today;
    const end = queryRange?.endDate ?? weeks.at(-1)?.days.at(-1)?.date ?? today;
    const latestData = days.reduce((latest, day) => (day.date > latest ? day.date : latest), "");
    const targetDate = today >= start && today <= end ? today : latestData || end;
    const target = container.querySelector<HTMLElement>(`[data-heatmap-date="${targetDate}"]`);
    if (target != null) {
      container.scrollLeft = Math.max(
        0,
        target.offsetLeft - container.clientWidth + target.offsetWidth
      );
    } else {
      container.scrollLeft = container.scrollWidth;
    }
    // Only reposition when the requested interval changes; data refreshes preserve manual scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  return (
    <div
      ref={scrollRef}
      role="region"
      aria-label={statsTabCopy.dailyHeatmap}
      tabIndex={0}
      className={cn("w-full overflow-x-auto pb-2", className)}
    >
      {/* Inner container with overflow-visible to allow tooltip to show outside */}
      <TooltipProvider>
        <div className="flex gap-[2px] min-h-[100px]">
          {weeks.map((week) => (
            <div key={week.weekIndex} className="flex flex-col gap-[2px] flex-shrink-0">
              {week.days.map(({ date, dayData }) => {
                const amount = dayData?.totalAmount ?? "0";
                const count = dayData?.entryCount ?? 0;
                const level = getHeatmapLevel(amount, stats);
                const inRange = range != null && date >= range.startDate && date <= range.endDate;

                return (
                  <div key={date} data-heatmap-date={date}>
                    {inRange ? (
                      <DayCellSmall
                        date={date}
                        amount={amount}
                        count={count}
                        level={level}
                        currency={currency}
                        locale={locale}
                        onClick={() => onDayClick?.(date)}
                      />
                    ) : (
                      // Padding cells keep the week grid aligned but must never
                      // trigger drilldown, tooltips, or keyboard focus.
                      <div
                        aria-hidden="true"
                        className="h-3 w-3 flex-shrink-0 rounded-sm bg-surface2/40"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </TooltipProvider>
    </div>
  );
}
