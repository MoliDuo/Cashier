import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { StatsContentView } from "@/modules/stats/ui/StatsContentView";
import { buildEnhancedStatsFixture } from "tests/helpers/stats-fixture";

const baseProps = {
  rangeType: "month" as const,
  contentRangeType: "month" as const,
  onRangeTypeChange: () => {},
  periodOffset: 0,
  onPeriodOffsetChange: () => {},
  label: "2026年8月",
  startDate: new Date(2026, 7, 1),
  endDate: new Date(2026, 7, 6),
  startDateStr: "2026-08-01",
  endDateStr: "2026-08-06",
  stats: undefined,
  chartView: "heatmap" as const,
  onChartViewChange: () => {},
  fallbackCurrency: "CNY",
};

const statsFixture = buildEnhancedStatsFixture();

describe("StatsContentView", () => {
  it("shows an error panel instead of zero totals when the query failed without data", () => {
    render(<StatsContentView {...baseProps} isError onRetry={() => {}} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("统计数据加载失败，请重试。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.queryByText("总支出")).not.toBeInTheDocument();
    expect(screen.queryByText(/0\.00/)).not.toBeInTheDocument();
  });

  it("keeps stale data and shows an inline warning when a refresh fails", () => {
    render(<StatsContentView {...baseProps} stats={statsFixture} isError />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("总支出")).toBeInTheDocument();
    expect(screen.getByText("¥120.00")).toBeInTheDocument();
  });

  it("calls onRetry when the retry button is clicked", () => {
    const onRetry = vi.fn();
    render(<StatsContentView {...baseProps} isError onRetry={onRetry} />);

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("marks the active chart view toggle with aria-pressed", () => {
    function Harness() {
      const [chartView, setChartView] = useState<"trend" | "heatmap">("heatmap");
      return (
        <StatsContentView
          {...baseProps}
          stats={statsFixture}
          chartView={chartView}
          onChartViewChange={setChartView}
        />
      );
    }
    render(<Harness />);

    const heatmapButton = screen.getByRole("button", { name: "热力" });
    const trendButton = screen.getByRole("button", { name: "趋势" });
    expect(heatmapButton).toHaveAttribute("aria-pressed", "true");
    expect(trendButton).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(trendButton);
    expect(trendButton).toHaveAttribute("aria-pressed", "true");
    expect(heatmapButton).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps comparison copy bound to the committed content range", () => {
    render(
      <StatsContentView
        {...baseProps}
        rangeType="week"
        contentRangeType="year"
        stats={statsFixture}
      />
    );

    expect(screen.getByText(/去年/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "周" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the ranking beside the chosen view rather than behind it", () => {
    // The ranking used to sit below a full-width heatmap, off the bottom of a
    // desktop screen. Both panels are now on the page at once.
    render(<StatsContentView {...baseProps} stats={statsFixture} />);

    expect(screen.getByRole("heading", { name: "每日热力图" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "支出排行" })).toBeVisible();
  });

  it("holds the weekday breakdown back for a week, which has one of each day", () => {
    const stats = buildEnhancedStatsFixture({
      chart: [{ date: "2026-08-03", total: "120" }],
      heatmap: {
        days: [{ date: "2026-08-03", totalAmount: "120", entryCount: 1, currencies: ["CNY"] }],
        stats: { minAmount: "0", maxAmount: "0", avgAmount: "0", p80Amount: "0" },
      },
    });
    const { rerender } = render(
      <StatsContentView {...baseProps} contentRangeType="week" stats={stats} />
    );
    expect(screen.queryByRole("heading", { name: "星期节律" })).not.toBeInTheDocument();

    rerender(<StatsContentView {...baseProps} contentRangeType="month" stats={stats} />);
    expect(screen.getByRole("heading", { name: "星期节律" })).toBeVisible();
  });
});
