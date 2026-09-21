import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatsSparkline } from "@/modules/stats/ui/StatsSparkline";

function series(totals: string[]) {
  return totals.map((total, index) => ({ date: `2026-09-0${index + 1}`, total }));
}

describe("StatsSparkline", () => {
  it("draws nothing when the period holds no days", () => {
    const { container } = render(<StatsSparkline current={[]} previous={series(["5"])} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("draws this period alone when there is nothing to compare against", () => {
    const { container } = render(<StatsSparkline current={series(["10", "20"])} previous={[]} />);

    expect(container.querySelectorAll("polyline")).toHaveLength(1);
  });

  it("lays last period under this one", () => {
    const { container } = render(
      <StatsSparkline current={series(["10", "20"])} previous={series(["30", "5"])} />
    );

    expect(container.querySelectorAll("polyline")).toHaveLength(2);
    expect(screen.getByRole("img", { name: "本期日支出" })).toBeInTheDocument();
  });

  it("is not a control when it has nowhere to lead", () => {
    render(<StatsSparkline current={series(["10", "20"])} previous={[]} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
