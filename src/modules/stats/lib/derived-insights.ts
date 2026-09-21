import { abs, add, compare, divide, multiply } from "@/lib/money/decimal";
import { parseDateString } from "@/lib/date-utils";
import type { EnhancedStatsDto } from "@/modules/stats/contracts";
import { generateHeatmapDateKeys } from "./heatmap-range";

/**
 * A category has to move by this much of the period's spending before it is
 * worth calling out. Growth from a previous total of zero is reported as
 * +100% no matter how small, so a ¥3 category would otherwise win the headline
 * every time. A share of the total rather than a fixed sum keeps the threshold
 * meaningful in every currency.
 */
const TOP_MOVER_MINIMUM_SHARE = "0.05";

export interface WeekdayAverage {
  /** 0 = Monday … 6 = Sunday, matching `Calendar.weekDaysMon`. */
  weekday: number;
  /**
   * Divided by how many times this weekday falls in the window, not by how
   * many of those days had entries — otherwise every weekday averages out to
   * roughly the daily average and the shape disappears.
   */
  average: string;
  occurrences: number;
}

export interface StatsInsights {
  entryCount: number;
  /** Null when nothing was recorded, so the surface can say so rather than show a zero. */
  averageEntry: string | null;
  activeDays: number;
  periodDays: number;
  /** Null only when the window holds no days at all; a period that nets out negative still has a biggest day. */
  busiestDay: { date: string; total: string } | null;
  longestStreak: number;
  /** Always seven entries, Monday first. */
  weekdayAverages: WeekdayAverage[];
  topMover: {
    id: string | null;
    name: string;
    amountDelta: string;
    direction: "up" | "down";
  } | null;
}

/** Monday-first weekday index, matching the heatmap grid's own leading offset. */
function weekdayIndex(date: string): number {
  return (parseDateString(date).getDay() + 6) % 7;
}

/**
 * Figures the statistics read already contains but does not spell out. Every
 * one of them is derived from the payload that is on screen, so they cannot
 * disagree with the heatmap and the ranking beside them.
 */
export function deriveStatsInsights(
  stats: EnhancedStatsDto,
  queryRange: { startDate: string; endDate: string }
): StatsInsights {
  const dateKeys = generateHeatmapDateKeys(queryRange);
  // The day map is keyed on the entry date, and a row whose date is missing
  // reaches the categories but not the days. Counting entries through the
  // categories is the only place that sees all of them.
  const entryCount = stats.categories.reduce((sum, category) => sum + category.count, 0);

  const dayByDate = new Map(stats.heatmap.days.map((day) => [day.date, day]));
  // A day that nets out to zero because something was bought and returned is
  // still a day that was recorded, so activity is counted in entries.
  const activeDays = stats.heatmap.days.filter((day) => day.entryCount > 0).length;

  let longestStreak = 0;
  let runningStreak = 0;
  const weekdayTotals = Array.from({ length: 7 }, () => ({ total: "0", occurrences: 0 }));
  for (const date of dateKeys) {
    const day = dayByDate.get(date);
    runningStreak = (day?.entryCount ?? 0) > 0 ? runningStreak + 1 : 0;
    if (runningStreak > longestStreak) longestStreak = runningStreak;

    const weekday = weekdayTotals[weekdayIndex(date)];
    if (weekday == null) continue;
    weekday.occurrences += 1;
    weekday.total = add(weekday.total, day?.totalAmount ?? "0");
  }

  const busiestDay = stats.chart.reduce<{ date: string; total: string } | null>(
    (best, point) => (best == null || compare(point.total, best.total) > 0 ? point : best),
    null
  );

  const topMover = pickTopMover(stats);

  return {
    entryCount,
    averageEntry: entryCount > 0 ? divide(stats.summary.total, String(entryCount)) : null,
    activeDays,
    periodDays: dateKeys.length,
    busiestDay,
    longestStreak,
    weekdayAverages: weekdayTotals.map((weekday, index) => ({
      weekday: index,
      occurrences: weekday.occurrences,
      average: weekday.occurrences > 0 ? divide(weekday.total, String(weekday.occurrences)) : "0",
    })),
    topMover,
  };
}

function pickTopMover(stats: EnhancedStatsDto): StatsInsights["topMover"] {
  // With nothing to compare against, every category has "grown by 100%" and
  // the comparison means nothing.
  if (compare(stats.summary.comparison.previousTotal, "0") === 0) return null;

  const threshold = multiply(abs(stats.summary.total), TOP_MOVER_MINIMUM_SHARE);
  const leader = stats.categories.reduce<EnhancedStatsDto["categories"][number] | null>(
    (best, category) =>
      best == null || compare(abs(category.trend.amount), abs(best.trend.amount)) > 0
        ? category
        : best,
    null
  );
  if (leader == null) return null;

  const delta = leader.trend.amount;
  if (compare(abs(delta), threshold) < 0) return null;
  return {
    id: leader.id,
    name: leader.name,
    amountDelta: abs(delta),
    direction: compare(delta, "0") > 0 ? "up" : "down",
  };
}
