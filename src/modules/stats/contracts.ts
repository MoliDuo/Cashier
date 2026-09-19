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
