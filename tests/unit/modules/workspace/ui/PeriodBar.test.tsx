import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PeriodBar } from "@/modules/workspace/ui/PeriodBar";

const TODAY = "2026-09-27";

describe("PeriodBar", () => {
  it("names the period and steps a calendar period back and forth", async () => {
    const onChange = vi.fn();
    render(<PeriodBar period={{ range: "week", offset: -1 }} today={TODAY} onChange={onChange} />);

    expect(screen.getByRole("button", { name: "区间：9月14日 – 20日" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "上一期" }));
    await userEvent.click(screen.getByRole("button", { name: "下一期" }));
    expect(onChange.mock.calls).toEqual([
      [{ range: "week", offset: -2 }],
      [{ range: "week", offset: 0 }],
    ]);
  });

  it("has nothing to step for everything or two named days", () => {
    const { rerender } = render(
      <PeriodBar period={{ range: "all" }} today={TODAY} onChange={vi.fn()} />
    );
    expect(screen.queryByRole("button", { name: "上一期" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "区间：全部" })).toBeInTheDocument();

    rerender(
      <PeriodBar
        period={{ range: "custom", from: "2025-12-30", to: "2026-01-02" }}
        today={TODAY}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText("2025年12月30日 – 2026年1月2日")).toBeInTheDocument();
  });

  it("switches to another kind of period from its name", async () => {
    const onChange = vi.fn();
    render(<PeriodBar period={{ range: "month", offset: -3 }} today={TODAY} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "区间：2026年6月" }));
    await userEvent.click(screen.getByRole("button", { name: "年" }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "2025年" }));
    expect(onChange).toHaveBeenCalledWith({ range: "year", offset: -1 });
  });

  it("applies a hand-picked range starting from the days shown", async () => {
    const onChange = vi.fn();
    render(<PeriodBar period={{ range: "month", offset: 0 }} today={TODAY} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "区间：2026年9月" }));
    await userEvent.click(screen.getByRole("button", { name: "自定义" }));
    await userEvent.click(screen.getByRole("button", { name: "应用" }));
    expect(onChange).toHaveBeenCalledWith({
      range: "custom",
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });
});
