import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatsRanking } from "@/modules/stats/ui/StatsRanking";

function category(overrides: Partial<Parameters<typeof StatsRanking>[0]["data"][number]> = {}) {
  return {
    id: "food",
    name: "Dining",
    icon: null,
    totalConverted: "30",
    percent: 100,
    count: 2,
    ...overrides,
  };
}

describe("StatsRanking", () => {
  it("shows an empty state instead of rendering nothing", () => {
    render(<StatsRanking data={[]} currencySymbol="CNY" />);

    expect(screen.getByText("暂无统计")).toBeInTheDocument();
  });

  it("keeps every other category's share when one nets out negative", () => {
    // A refund used to blank out the whole column: one negative category hid
    // the bar and the percentage for every row, including the ones that were
    // plainly positive.
    render(
      <StatsRanking
        currencySymbol="CNY"
        data={[
          category({ id: "food", name: "Dining", totalConverted: "30", percent: 100 }),
          category({ id: "discount", name: "Discount", totalConverted: "-5", percent: 0 }),
        ]}
      />
    );

    expect(screen.getByRole("button", { name: /Dining/ })).toHaveAccessibleName(/100%/);
    expect(screen.getByRole("button", { name: /Discount/ })).toHaveAccessibleName(/无占比/);
  });

  it("still names the amount of a category that has no share", () => {
    render(
      <StatsRanking
        currencySymbol="CNY"
        data={[category({ id: "discount", name: "Discount", totalConverted: "-5", percent: 0 })]}
      />
    );

    expect(screen.getByRole("button", { name: /Discount/ })).toHaveAccessibleName(/-¥5\.00/);
  });

  it("reports how many entries each category holds", () => {
    render(<StatsRanking currencySymbol="CNY" data={[category({ count: 7 })]} />);

    expect(within(screen.getByRole("button", { name: /Dining/ })).getByText("7笔")).toBeVisible();
  });

  it("folds the tail away until asked for it", () => {
    const data = Array.from({ length: 9 }, (_, index) =>
      category({ id: `c${index}`, name: `Category ${index}` })
    );
    render(<StatsRanking currencySymbol="CNY" data={data} />);

    expect(screen.queryByRole("button", { name: /Category 6/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "显示全部（3）" }));
    expect(screen.getByRole("button", { name: /Category 8/ })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(screen.queryByRole("button", { name: /Category 6/ })).not.toBeInTheDocument();
  });

  it("does not offer to expand a ranking that already fits", () => {
    const data = Array.from({ length: 4 }, (_, index) =>
      category({ id: `c${index}`, name: `Category ${index}` })
    );
    render(<StatsRanking currencySymbol="CNY" data={data} />);

    expect(screen.queryByRole("button", { name: /显示全部/ })).not.toBeInTheDocument();
  });
});
