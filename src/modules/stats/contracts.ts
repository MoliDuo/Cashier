import type { CalendarDayData, CalendarHeatmapStats } from "@/types/calendar";

type EnhancedCategoryStatDto = {
  id: string | null;
  name: string;
  icon: string | null;
  totalConverted: string;
  currency: string;
  percent: number;
  count: number;
  trend: {
    percent: number;
    amount: string;
  };
};

export type StatsComparisonMode = "same_period" | "full_period";

/**
 * The per-book totals 统计 shows under its strip, in one read: one row per book
 * that has entries in the range, plus 总账 (every book, archived included).
 * A book with no entries in the range is absent rather than zero, so the caller
 * decides how an empty book reads.
 */
export interface BookTotalsDto {
  /** The ledger's main currency, which the totals are converted into. */
  currency: string;
  /** 总账: every book, archived ones included. */
  total: string;
  /** One row per book holding entries in the range. */
  books: { bookId: string; total: string }[];
}

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
  heatmap: {
    days: CalendarDayData[];
    stats: CalendarHeatmapStats;
  };
}
