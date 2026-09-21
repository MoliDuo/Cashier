import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LargeGridHeatmap } from "@/modules/stats/ui/AdaptiveHeatmap/LargeGrid";

const noStats = { minAmount: "0", maxAmount: "0", avgAmount: "0", p80Amount: "0" };

describe("LargeGridHeatmap", () => {
  it("names the weekday of every column", () => {
    // Seven unlabelled squares in a row leave the reader counting back from
    // today to work out which column is Saturday.
    const { container } = render(
      <LargeGridHeatmap
        days={[]}
        stats={noStats}
        currency="CNY"
        locale="zh-CN"
        queryRange={{ startDate: "2026-09-07", endDate: "2026-09-13" }}
      />
    );

    const grid = container.querySelector(".grid")!;
    const headers = [...grid.children].slice(0, 7).map((child) => child.textContent);
    expect(headers).toEqual(["一", "二", "三", "四", "五", "六", "日"]);
  });

  it("keeps the header row ahead of the cells that pad the first week", () => {
    // 2026-09-10 is a Thursday, so three blanks precede it. They have to come
    // after the header row or the week lands under the wrong labels.
    const { container } = render(
      <LargeGridHeatmap
        days={[]}
        stats={noStats}
        currency="CNY"
        locale="zh-CN"
        queryRange={{ startDate: "2026-09-10", endDate: "2026-09-12" }}
      />
    );

    const children = [...container.querySelector(".grid")!.children];
    expect(children.slice(0, 7).map((child) => child.textContent)).toEqual([
      "一",
      "二",
      "三",
      "四",
      "五",
      "六",
      "日",
    ]);
    expect(children.slice(7, 10).every((child) => child.textContent === "")).toBe(true);
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("shows a day's figure without repeating the currency symbol in the cell", () => {
    render(
      <LargeGridHeatmap
        days={[{ date: "2026-09-07", totalAmount: "2200", entryCount: 1, currencies: ["CNY"] }]}
        stats={{ ...noStats, p80Amount: "2200", maxAmount: "2200", avgAmount: "2200" }}
        currency="CNY"
        locale="zh-CN"
        queryRange={{ startDate: "2026-09-07", endDate: "2026-09-07" }}
      />
    );

    const cell = screen.getByRole("button");
    expect(cell).toHaveTextContent("2200");
    expect(cell.textContent).not.toContain("¥");
    // The exact figure, currency and all, is still what gets announced.
    expect(cell).toHaveAccessibleName(/¥2200/);
  });
});
