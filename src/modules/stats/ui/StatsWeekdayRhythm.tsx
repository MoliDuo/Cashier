"use client";
import { textRoleClassName } from "@/components/typography";
import { formatCurrencyAmount } from "@/lib/format/currency";
import { compare } from "@/lib/money/decimal";
import { cn } from "@/lib/utils";
import type { StatsInsights } from "@/modules/stats/lib/derived-insights";
import { StatsPanel } from "./StatsPanel";
import { DISPLAY_LOCALE } from "@/lib/constants";
import { calendarCopy } from "@/copy/controls";
import { statsTabCopy } from "@/copy/stats";

interface StatsWeekdayRhythmProps {
  weekdayAverages: StatsInsights["weekdayAverages"];
  currencySymbol: string;
}

/**
 * Average spend per weekday, Monday first.
 *
 * Neither the heatmap nor the ranking can answer "which day of the week costs
 * me the most" — the heatmap shows every day separately and the ranking has no
 * time in it at all. Seven bars is the whole answer.
 */
export function StatsWeekdayRhythm({ weekdayAverages, currencySymbol }: StatsWeekdayRhythmProps) {
  const locale = DISPLAY_LOCALE;
  // The key is spelled out rather than built, so the catalogue check can see it.
  const weekdayNames = calendarCopy.weekDaysMon;

  const peak = weekdayAverages.reduce(
    (best, day) => (compare(day.average, best) > 0 ? day.average : best),
    "0"
  );
  if (compare(peak, "0") <= 0) return null;

  return (
    <StatsPanel title={statsTabCopy.weekdayRhythm}>
      <div className="grid grid-cols-7 items-end gap-1.5">
        {weekdayAverages.map((day) => {
          const name = weekdayNames[day.weekday] ?? "";
          const ratio = Math.max(0, Math.min(1, Number(day.average) / Number(peak)));
          const isPeak = compare(day.average, peak) === 0;
          return (
            <div key={day.weekday} className="flex min-w-0 flex-col items-center gap-1.5">
              <div className="flex h-16 w-full items-end">
                <div
                  aria-hidden="true"
                  className={cn(
                    "w-full origin-bottom rounded-sm transition-transform duration-[var(--motion-expand)] ease-[var(--motion-enter)]",
                    isPeak ? "bg-primary" : "bg-primary/35"
                  )}
                  style={{ height: "100%", transform: `scaleY(${Math.max(ratio, 0.02)})` }}
                />
                <span className="sr-only">
                  {statsTabCopy.weekdayAverage({
                    weekday: name,
                    amount: formatCurrencyAmount(day.average, currencySymbol, locale),
                  })}
                </span>
              </div>
              <span
                aria-hidden="true"
                className={textRoleClassName(
                  "micro",
                  cn("text-center", isPeak && "font-semibold text-text")
                )}
              >
                {name}
              </span>
            </div>
          );
        })}
      </div>
    </StatsPanel>
  );
}
