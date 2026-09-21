import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatsWeekdayRhythm } from "@/modules/stats/ui/StatsWeekdayRhythm";

const flat = Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  average: "0",
  occurrences: 4,
}));

describe("StatsWeekdayRhythm", () => {
  it("stays out of the way when no weekday has anything on it", () => {
    const { container } = render(
      <StatsWeekdayRhythm weekdayAverages={flat} currencySymbol="CNY" />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("labels every column and announces what each one averages", () => {
    const averages = flat.map((day) => ({ ...day, average: day.weekday === 4 ? "210" : "50" }));
    render(<StatsWeekdayRhythm weekdayAverages={averages} currencySymbol="CNY" />);

    // Monday first, matching the heatmap grid beside it.
    expect(screen.getByText("一")).toBeVisible();
    expect(screen.getByText("周五平均 ¥210.00")).toBeInTheDocument();
    expect(screen.getByText("周一平均 ¥50.00")).toBeInTheDocument();
  });
});
