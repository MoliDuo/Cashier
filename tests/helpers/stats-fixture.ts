import type { EnhancedStatsDto } from "@/modules/stats/contracts";

/**
 * The statistics payload a stats surface renders. Both the tab and the content
 * view need a whole `EnhancedStatsDto` to render anything at all, and they need
 * the same one, so the shape lives here rather than being spelled out twice and
 * drifting when the contract grows a field.
 */
export function buildEnhancedStatsFixture(
  overrides: Partial<EnhancedStatsDto> = {}
): EnhancedStatsDto {
  return {
    unconvertedCount: 0,
    summary: {
      total: "120",
      currency: "CNY",
      dailyAverage: "20",
      comparison: {
        mode: "same_period",
        from: "2026-07-01",
        to: "2026-07-06",
        previousTotal: "60",
        amountDelta: "60",
        percent: 100,
      },
    },
    categories: [],
    chart: [],
    previousChart: [],
    heatmap: {
      days: [],
      stats: { minAmount: "0", maxAmount: "0", avgAmount: "0", p80Amount: "0" },
    },
    ...overrides,
  };
}
