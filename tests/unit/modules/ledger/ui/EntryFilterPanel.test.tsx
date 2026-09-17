import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EntryFilterPanel } from "@/modules/ledger/ui/EntryFilterPanel";

vi.mock("@/components/ui/date-filter", () => ({
  DateFilter: () => <button type="button">date</button>,
}));

// The panel is one dialog at every width, so nothing inside it exists until the
// trigger opens it — the same way it works in the app.
async function openPanel() {
  await userEvent.click(screen.getByRole("button", { name: /筛选/ }));
  return screen.getByRole("dialog", { name: "筛选" });
}

describe("EntryFilterPanel", () => {
  it("counts only non-default periods as active filters", () => {
    const view = render(
      <EntryFilterPanel
        filters={{}}
        periodParams={{ period: "thisMonth" }}
        onFiltersChange={vi.fn()}
        showCategory={false}
        showCurrency={false}
      />
    );
    expect(screen.getByRole("button", { name: "筛选" })).toBeInTheDocument();

    view.rerender(
      <EntryFilterPanel
        filters={{}}
        periodParams={{ period: "all" }}
        onFiltersChange={vi.fn()}
        showCategory={false}
        showCurrency={false}
      />
    );
    expect(screen.getByRole("button", { name: "已启用 1 个筛选" })).toBeInTheDocument();
  });

  it("opens a dialog and applies the shared draft", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();

    render(
      <EntryFilterPanel
        filters={{}}
        onFiltersChange={onFiltersChange}
        showCategory={false}
        showCurrency={false}
        periodParams={{ period: "thisMonth" }}
      />
    );

    const dialog = await openPanel();
    expect(dialog).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("搜索标题、名称或描述"), "coffee");
    await user.click(screen.getByRole("button", { name: "应用筛选" }));

    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ search: "coffee" }));
    expect(screen.queryByRole("dialog", { name: "筛选" })).not.toBeInTheDocument();
  });

  it("promises a dialog rather than a dropdown", () => {
    const { container } = render(
      <EntryFilterPanel
        filters={{}}
        onFiltersChange={vi.fn()}
        showCategory={false}
        showCurrency={false}
        periodParams={{ period: "thisMonth" }}
      />
    );

    expect(screen.getByRole("button", { name: "筛选" })).toHaveAttribute("aria-haspopup", "dialog");
    expect(container.querySelector(".lucide-chevron-down")).toBeNull();
  });

  it("offers the four date presets and no other windows", async () => {
    render(
      <EntryFilterPanel
        filters={{}}
        periodParams={{ period: "thisMonth" }}
        onFiltersChange={vi.fn()}
        showCategory={false}
        showCurrency={false}
      />
    );
    await openPanel();

    const group = screen.getByRole("group", { name: "时间范围" });
    expect(group).toBeInTheDocument();
    for (const label of ["本月", "上个月", "全部", "自定义区间"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "过去7天" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "最近30天" })).not.toBeInTheDocument();
  });

  it("shows the start and end fields only for a hand-picked range", async () => {
    const view = render(
      <EntryFilterPanel
        filters={{}}
        periodParams={{ period: "thisMonth" }}
        onFiltersChange={vi.fn()}
        showCategory={false}
        showCurrency={false}
      />
    );
    await openPanel();
    expect(screen.queryAllByRole("button", { name: "date" })).toHaveLength(0);

    view.rerender(
      <EntryFilterPanel
        filters={{}}
        periodParams={{ period: "custom", startDate: "2026-09-01", endDate: "2026-09-10" }}
        onFiltersChange={vi.fn()}
        showCategory={false}
        showCurrency={false}
      />
    );
    expect(screen.getAllByRole("button", { name: "date" })).toHaveLength(2);
  });

  it("offers every processing status as one chip", async () => {
    render(
      <EntryFilterPanel
        filters={{}}
        onFiltersChange={vi.fn()}
        showCategory={false}
        showCurrency={false}
        periodParams={{ period: "thisMonth" }}
      />
    );
    await openPanel();

    // The status set is a row of toggle buttons; its name is carried for screen
    // readers only, because the chips already say what they filter.
    const group = screen.getByRole("group", { name: "状态" });
    expect(group).toBeInTheDocument();
    for (const label of ["处理中", "已完成", "失败", "已取消"]) {
      const chip = screen.getByRole("button", { name: label });
      expect(group.contains(chip)).toBe(true);
      expect(chip).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("toggles a status off the chip itself, without a separate control", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();

    render(
      <EntryFilterPanel
        filters={{}}
        onFiltersChange={onFiltersChange}
        showCategory={false}
        showCurrency={false}
        periodParams={{ period: "thisMonth" }}
      />
    );
    await openPanel();

    await user.click(screen.getByRole("button", { name: "失败" }));
    await user.click(screen.getByRole("button", { name: "已取消" }));
    expect(screen.getByRole("button", { name: "失败" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "全部状态" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "应用筛选" }));
    expect(onFiltersChange.mock.calls[0]?.[0].statuses).toEqual(["failed", "cancelled"]);
  });

  it("drops a status the user taps a second time", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();

    render(
      <EntryFilterPanel
        filters={{ statuses: ["processing"] }}
        onFiltersChange={onFiltersChange}
        showCategory={false}
        showCurrency={false}
        periodParams={{ period: "thisMonth" }}
      />
    );
    await openPanel();

    const chip = screen.getByRole("button", { name: "处理中" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    await user.click(chip);
    await user.click(screen.getByRole("button", { name: "应用筛选" }));

    expect(onFiltersChange.mock.calls[0]?.[0].statuses).toEqual([]);
  });

  it("submits filters only once after selecting a date preset", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();

    render(
      <EntryFilterPanel
        filters={{ categoryId: "cat-1" }}
        onFiltersChange={onFiltersChange}
        periodParams={{ period: "thisMonth" }}
        showCategory={false}
        showCurrency={false}
      />
    );
    await openPanel();

    await user.click(screen.getByRole("button", { name: "本月" }));
    await user.click(screen.getByRole("button", { name: "应用筛选" }));

    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ categoryId: "cat-1" }),
      "thisMonth"
    );
  });

  it("submits a hand-picked range as a custom period", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();

    render(
      <EntryFilterPanel
        filters={{}}
        periodParams={{ period: "thisMonth" }}
        onFiltersChange={onFiltersChange}
        showCategory={false}
        showCurrency={false}
      />
    );
    await openPanel();

    await user.click(screen.getByRole("button", { name: "自定义区间" }));
    await user.click(screen.getByRole("button", { name: "应用筛选" }));

    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(onFiltersChange).toHaveBeenCalledWith(expect.anything(), "custom");
  });

  it("submits last month as a named period", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();

    render(
      <EntryFilterPanel
        filters={{}}
        periodParams={{ period: "thisMonth" }}
        onFiltersChange={onFiltersChange}
        showCategory={false}
        showCurrency={false}
      />
    );
    await openPanel();

    await user.click(screen.getByRole("button", { name: "上个月" }));
    await user.click(screen.getByRole("button", { name: "应用筛选" }));

    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(onFiltersChange).toHaveBeenCalledWith(expect.anything(), "lastMonth");
  });

  it("omits the member scope when the tab has no members to pick from", async () => {
    render(
      <EntryFilterPanel
        filters={{}}
        periodParams={{ period: "thisMonth" }}
        onFiltersChange={vi.fn()}
        showCategory={false}
        showCurrency={false}
      />
    );
    await openPanel();

    expect(screen.queryByRole("group", { name: "账目视角" })).not.toBeInTheDocument();
  });

  it("offers the member scope inside the dialog", async () => {
    render(
      <EntryFilterPanel
        filters={{}}
        periodParams={{ period: "thisMonth" }}
        onFiltersChange={vi.fn()}
        recordScope="all"
        onRecordScopeChange={vi.fn()}
        showCategory={false}
        showCurrency={false}
      />
    );
    await openPanel();

    const group = screen.getByRole("group", { name: "账目视角" });
    // 全部 is also the name of the date preset, so the scope options are read
    // from inside their own group.
    for (const label of ["全部", "我", "对方"]) {
      expect(within(group).getByRole("button", { name: label })).toHaveAttribute(
        "aria-pressed",
        label === "全部" ? "true" : "false"
      );
    }
  });

  it("commits the picked scope with the rest of the draft", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    const onRecordScopeChange = vi.fn();

    render(
      <EntryFilterPanel
        filters={{}}
        periodParams={{ period: "thisMonth" }}
        onFiltersChange={onFiltersChange}
        recordScope="all"
        onRecordScopeChange={onRecordScopeChange}
        showCategory={false}
        showCurrency={false}
      />
    );
    await openPanel();

    await user.click(screen.getByRole("button", { name: "对方" }));
    await user.click(screen.getByRole("button", { name: "应用筛选" }));

    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(onRecordScopeChange).toHaveBeenCalledWith("partner");
  });

  it("leaves the applied scope alone when the draft never touched it", async () => {
    const user = userEvent.setup();
    const onRecordScopeChange = vi.fn();

    render(
      <EntryFilterPanel
        filters={{}}
        periodParams={{ period: "thisMonth" }}
        onFiltersChange={vi.fn()}
        recordScope="mine"
        onRecordScopeChange={onRecordScopeChange}
        showCategory={false}
        showCurrency={false}
      />
    );
    await openPanel();

    await user.click(screen.getByRole("button", { name: "应用筛选" }));

    expect(onRecordScopeChange).not.toHaveBeenCalled();
  });

  it("counts a narrowed scope as one of the active filters", async () => {
    render(
      <EntryFilterPanel
        filters={{}}
        periodParams={{ period: "thisMonth" }}
        onFiltersChange={vi.fn()}
        recordScope="partner"
        onRecordScopeChange={vi.fn()}
        showCategory={false}
        showCurrency={false}
      />
    );

    expect(screen.getByRole("button", { name: "已启用 1 个筛选" })).toBeInTheDocument();
    await openPanel();
    expect(screen.getByRole("button", { name: "对方" })).toHaveAttribute("aria-pressed", "true");
  });

  it("puts the scope back to everyone on 清除全部", async () => {
    const user = userEvent.setup();

    render(
      <EntryFilterPanel
        filters={{}}
        periodParams={{ period: "thisMonth" }}
        onFiltersChange={vi.fn()}
        recordScope="partner"
        onRecordScopeChange={vi.fn()}
        showCategory={false}
        showCurrency={false}
      />
    );
    await openPanel();

    await user.click(screen.getByRole("button", { name: "清除全部" }));

    const group = screen.getByRole("group", { name: "账目视角" });
    expect(within(group).getByRole("button", { name: "全部" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});
