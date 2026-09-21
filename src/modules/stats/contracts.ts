import type { CalendarDayData, CalendarHeatmapStats } from "@/types/calendar";

type EnhancedCategoryStatDto = {
  id: string | null;
  name: string;
  icon: string | null;
  totalConverted: string;
  currency: string;
  /**
   * Share of the period's positive spending, so a refunded category cannot
   * shrink the denominator and push the others above 100%. Categories whose
   * own net is zero or negative have no share of spending and report 0.
   */
  percent: number;
  count: number;
  trend: {
    percent: number;
    amount: string;
  };
};

export type StatsComparisonMode = "same_period" | "full_period";

export interface EnhancedStatsDto {
  unconvertedCount: number;
  summary: {
    total: string;
    currency: string;
    /** Kept for one compatibility round; UI prefers `comparison`. */
    trend: {
      percent: number;
      amount: string;
    };
    dailyAverage: string;
    comparison: {
      mode: StatsComparisonMode;
      from: string;
      to: string;
      previousTotal: string;
      amountDelta: string;
      percent: number;
    };
  };
  categories: EnhancedCategoryStatDto[];
  chart: { date: string; total: string }[];
  /**
   * The comparison window's daily totals, in the same shape as `chart`. The two
   * windows cover different dates, so a reader aligns them by position — day
   * one against day one — rather than by date.
   */
  previousChart: { date: string; total: string }[];
  heatmap: {
    days: CalendarDayData[];
    stats: CalendarHeatmapStats;
  };
}
