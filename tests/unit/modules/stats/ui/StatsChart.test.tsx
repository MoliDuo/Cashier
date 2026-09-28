import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatsChart } from "@/modules/stats/ui/StatsChart";

const week = { from: "2026-08-03", to: "2026-08-09" };

describe("StatsChart", () => {
  it("draws a column for every day, the empty ones included", () => {
    render(
      <StatsChart
        data={[{ date: "2026-08-04", total: "40" }]}
        range={week}
        rangeType="week"
        currencySymbol="CNY"
      />
    );

    const columns = screen.getAllByRole("button");
    expect(columns).toHaveLength(7);
    expect(columns[1]).toHaveAccessibleName(/支出: ¥40\.00/);
    expect(columns[0]).toHaveAccessibleName(/支出: ¥0\.00/);
  });

  it("lines the previous period up from its first day, not its first record", () => {
    // The previous week's first record is on its Wednesday. Counted from that
    // record it would sit under this Monday; counted from the day the week
    // starts, it sits under this Wednesday.
    render(
      <StatsChart
        data={[{ date: "2026-08-05", total: "10" }]}
        range={week}
        previousData={[{ date: "2026-07-29", total: "25" }]}
        previousRange={{ from: "2026-07-27", to: "2026-08-02" }}
        rangeType="week"
        currencySymbol="CNY"
      />
    );

    const columns = screen.getAllByRole("button");
    expect(columns[0]).toHaveAccessibleName(/上期同期: ¥0\.00/);
    expect(columns[2]).toHaveAccessibleName(/上期同期: ¥25\.00/);
    expect(screen.getByText("上期同期")).toBeVisible();
  });

  it("names a column's day and both periods' figures when it is picked", () => {
    render(
      <StatsChart
        data={[{ date: "2026-08-05", total: "10" }]}
        range={week}
        previousData={[{ date: "2026-07-29", total: "25" }]}
        previousRange={{ from: "2026-07-27", to: "2026-08-02" }}
        rangeType="week"
        currencySymbol="CNY"
      />
    );

    fireEvent.click(screen.getAllByRole("button")[2]!);
    const tooltip = screen.getByRole("tooltip");
    expect(within(tooltip).getByText("本期 ¥10.00")).toBeVisible();
    expect(within(tooltip).getByText("上期同期 ¥25.00")).toBeVisible();
  });

  it("draws no comparison when there is none", () => {
    render(
      <StatsChart
        data={[{ date: "2026-08-05", total: "10" }]}
        range={week}
        rangeType="week"
        currencySymbol="CNY"
      />
    );

    expect(screen.queryByText("上期同期")).not.toBeInTheDocument();
  });

  it("keeps a tapped column's figures open", () => {
    // A tap sends pointer-enter and then a click; the click must not close
    // what the pointer had just opened.
    render(
      <StatsChart
        data={[{ date: "2026-08-05", total: "10" }]}
        range={week}
        rangeType="week"
        currencySymbol="CNY"
      />
    );
    const column = screen.getAllByRole("button")[2]!;

    fireEvent.pointerEnter(column);
    fireEvent.click(column);
    expect(screen.getByRole("tooltip")).toHaveTextContent("本期 ¥10.00");
  });

  it("caps the scale when a few big days would flatten the rest", () => {
    const month = Array.from({ length: 28 }, (_, index) => ({
      date: `2026-09-${String(index + 1).padStart(2, "0")}`,
      total: index === 16 || index === 5 ? "3000" : "30",
    }));
    render(
      <StatsChart
        data={month}
        range={{ from: "2026-09-01", to: "2026-09-28" }}
        rangeType="month"
        currencySymbol="CNY"
      />
    );

    expect(screen.getByText("已调整显示比例")).toBeVisible();
  });
});
