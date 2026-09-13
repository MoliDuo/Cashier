import { render, screen } from "@testing-library/react";
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

  it("renders status checkboxes for all processing statuses", async () => {
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

    // The status set is a checkbox group; its name is carried for screen
    // readers only, because the checkbox labels already say what it filters.
    expect(screen.getByRole("group", { name: "状态" })).toBeInTheDocument();
    expect(screen.getByText("处理中")).toBeDefined(); // checkbox label
    expect(screen.getByText("已完成")).toBeDefined();
    expect(screen.getByText("失败")).toBeDefined();
    expect(screen.getByText("已取消")).toBeDefined();
  });

  it("clears the status filter by unchecking, without a separate control", async () => {
    render(
      <EntryFilterPanel
        filters={{ statuses: ["failed"] }}
        onFiltersChange={vi.fn()}
        showCategory={false}
        showCurrency={false}
        periodParams={{ period: "thisMonth" }}
      />
    );
    await openPanel();

    expect(screen.queryByRole("button", { name: "全部状态" })).not.toBeInTheDocument();
  });

  it("keeps needs_attention preset in the draft until Apply", async () => {
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

    await user.click(screen.getByRole("button", { name: "待处理" }));
    expect(onFiltersChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "应用筛选" }));
    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(onFiltersChange.mock.calls[0]?.[0].statuses).toEqual(["failed", "cancelled"]);
  });

  it("keeps in_progress preset in the draft until Apply", async () => {
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

    await user.click(screen.getByRole("button", { name: "进行中" }));
    expect(onFiltersChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "应用筛选" }));
    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(onFiltersChange.mock.calls[0]?.[0].statuses).toEqual(["processing"]);
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
});
