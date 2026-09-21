import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StatsSummary } from "@/modules/stats/ui/StatsSummary";
import { deriveStatsInsights } from "@/modules/stats/lib/derived-insights";
import { buildEnhancedStatsFixture } from "tests/helpers/stats-fixture";
import { expectAmountVariant } from "tests/helpers/class-tables";

const week = { startDate: "2026-09-07", endDate: "2026-09-13" };

function propsFor(stats = buildEnhancedStatsFixture()) {
  return {
    total: stats.summary.total,
    dailyAverage: stats.summary.dailyAverage,
    currencySymbol: "CNY",
    comparison: stats.summary.comparison,
    periodLabel: "上月",
    insights: deriveStatsInsights(stats, week),
    chart: stats.chart,
    previousChart: stats.previousChart,
  };
}

describe("StatsSummary", () => {
  it("leads with the total at the shared hero size", () => {
    render(<StatsSummary {...propsFor()} />);

    expectAmountVariant(screen.getByText("¥120.00"), "hero");
  });

  it("puts the total in proportion with the figures behind it", () => {
    const stats = buildEnhancedStatsFixture({
      categories: [
        {
          id: "food",
          name: "Food",
          icon: null,
          totalConverted: "120",
          currency: "CNY",
          percent: 100,
          count: 4,
          trend: { percent: 0, amount: "0" },
        },
      ],
      chart: [{ date: "2026-09-07", total: "120" }],
      heatmap: {
        days: [{ date: "2026-09-07", totalAmount: "120", entryCount: 4, currencies: ["CNY"] }],
        stats: { minAmount: "0", maxAmount: "0", avgAmount: "0", p80Amount: "0" },
      },
    });

    render(<StatsSummary {...propsFor(stats)} />);

    expect(screen.getByText("4")).toBeVisible();
    expect(screen.getByText("¥30.00")).toBeVisible();
    expect(screen.getByText("1 / 7")).toBeVisible();
  });

  it("says there is no average entry rather than showing a zero one", () => {
    render(<StatsSummary {...propsFor()} />);

    expect(screen.getByText("—")).toBeVisible();
  });

  it("offers the full trend from the sparkline, and stops offering it once open", () => {
    const stats = buildEnhancedStatsFixture({
      chart: [
        { date: "2026-09-07", total: "10" },
        { date: "2026-09-08", total: "20" },
      ],
    });
    const onExpandTrend = vi.fn();
    const { rerender } = render(
      <StatsSummary {...propsFor(stats)} onExpandTrend={onExpandTrend} />
    );

    fireEvent.click(screen.getByRole("button", { name: "查看完整趋势" }));
    expect(onExpandTrend).toHaveBeenCalledOnce();

    rerender(<StatsSummary {...propsFor(stats)} />);
    expect(screen.queryByRole("button", { name: "查看完整趋势" })).not.toBeInTheDocument();
  });
});
