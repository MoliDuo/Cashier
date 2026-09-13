import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { EntryCategory } from "@/modules/ledger/contracts";
import { LedgerEntriesBatchActionToolbar } from "@/modules/ledger/ui/batch-action-toolbar";

const dining: EntryCategory = {
  id: "category-1",
  ledgerId: "ledger-1",
  name: "餐饮",
  description: null,
  icon: "Utensils",
  sortOrder: 0,
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
  deletedAt: null,
};

function renderToolbar(
  overrides: Partial<React.ComponentProps<typeof LedgerEntriesBatchActionToolbar>> = {}
) {
  const props = {
    selectedCount: 0,
    isAllSelected: false,
    onSelectAll: vi.fn(),
    onClearSelection: vi.fn(),
    ...overrides,
  };
  return { ...render(<LedgerEntriesBatchActionToolbar {...props} />), props };
}

describe("LedgerEntriesBatchActionToolbar", () => {
  it("offers select all, and says so, before anything is selected", () => {
    const { props } = renderToolbar();

    expect(screen.getByText("全选")).toBeInTheDocument();
    const master = screen.getByRole("checkbox", { name: "全选" });
    expect(master).toBeEnabled();

    fireEvent.click(master);
    expect(props.onSelectAll).toHaveBeenCalledOnce();
  });

  it("names what the control does rather than how many rows are in", () => {
    renderToolbar({ selectedCount: 3 });

    expect(screen.getByText("全选")).toBeInTheDocument();
    expect(screen.queryByText(/已选择|3/)).not.toBeInTheDocument();
  });

  it("flips the control's words once everything loaded is selected", () => {
    renderToolbar({ selectedCount: 3, isAllSelected: true });

    expect(screen.getByText("取消全选")).toBeInTheDocument();
    expect(screen.queryByText("全选")).not.toBeInTheDocument();
  });

  it("marks a partial selection as mixed", () => {
    renderToolbar({ selectedCount: 2, isAllSelected: false });

    expect(screen.getByRole("checkbox")).toHaveAttribute("data-state", "indeterminate");
  });

  it("keeps the loaded-scope note, without a number in it", () => {
    renderToolbar({ selectedCount: 3, isAllSelected: true, hasMoreData: true });

    expect(screen.getByText("仅选中已加载的部分")).toBeInTheDocument();
    expect(screen.queryByText(/仅选中已加载的 3/)).not.toBeInTheDocument();
  });

  it("keeps the actions visible but unavailable with nothing selected", () => {
    renderToolbar({ onChangeDate: vi.fn(), onDelete: vi.fn() });

    expect(screen.getByRole("button", { name: /修改日期/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /删除/ })).toBeDisabled();
  });

  it("enables the actions once something is selected", () => {
    const onDelete = vi.fn();
    renderToolbar({ selectedCount: 1, onDelete });

    const remove = screen.getByRole("button", { name: /删除/ });
    expect(remove).toBeEnabled();
    fireEvent.click(remove);
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("renders the actions its entity supports, in one order", () => {
    renderToolbar({
      selectedCount: 1,
      categories: [],
      onChangeCategory: vi.fn(),
      onChangeCurrency: vi.fn(),
      onChangeDate: vi.fn(),
      onDelete: vi.fn(),
    });

    // jsdom does not apply `display: none`, so a button with a mobile label
    // carries both spans here; the order is what this asserts.
    const labels = screen
      .getAllByRole("button")
      .map((button) => button.textContent ?? "")
      .filter((label) => label !== "");
    expect(labels).toHaveLength(4);
    ["指定分类", "修改日期", "修改货币", "删除"].forEach((label, index) => {
      expect(labels[index]).toContain(label);
    });
  });

  it("renders no action row where the surface supports no batch write", () => {
    renderToolbar({ selectedCount: 2 });

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("applies the category the picker lists, and closes it", async () => {
    const onChangeCategory = vi.fn();
    renderToolbar({ selectedCount: 1, categories: [dining], onChangeCategory });

    await userEvent.click(screen.getByRole("button", { name: /指定分类/ }));
    await userEvent.click(await screen.findByRole("button", { name: "餐饮" }));

    expect(onChangeCategory).toHaveBeenCalledWith("category-1");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("offers the uncategorized row the menu used to carry", async () => {
    const onChangeCategory = vi.fn();
    renderToolbar({ selectedCount: 1, categories: [dining], onChangeCategory });

    await userEvent.click(screen.getByRole("button", { name: /指定分类/ }));
    await userEvent.click(await screen.findByRole("button", { name: "未分类" }));

    expect(onChangeCategory).toHaveBeenCalledWith(null);
  });

  it("applies the currency the picker lists", async () => {
    const onChangeCurrency = vi.fn();
    renderToolbar({
      selectedCount: 1,
      preferredCurrencies: ["SGD"],
      onChangeCurrency,
    });

    await userEvent.click(screen.getByRole("button", { name: /修改货币/ }));
    await userEvent.click(await screen.findByRole("button", { name: "SGD" }));

    expect(onChangeCurrency).toHaveBeenCalledWith("SGD");
  });

  it("opens the AI candidate picker and holds the button until two are chosen", async () => {
    const onStartAiCategory = vi.fn();
    const onToggleAiCategory = vi.fn();
    renderToolbar({
      selectedCount: 5,
      categories: [dining],
      onOpenAiCategory: vi.fn(),
      aiCategoryDialogOpen: true,
      onToggleAiCategory,
      onStartAiCategory,
      aiCategorySelection: [],
    });

    const start = screen.getByRole("button", { name: "开始归类" });
    expect(start).toBeDisabled();
    expect(screen.getByText("至少选择 2 个候选分类")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /餐饮/ }));
    expect(onToggleAiCategory).toHaveBeenCalledWith("category-1", true);
    expect(onStartAiCategory).not.toHaveBeenCalled();
  });

  it("starts the run once the candidate set is large enough", () => {
    const onStartAiCategory = vi.fn();
    renderToolbar({
      selectedCount: 5,
      categories: [dining],
      onOpenAiCategory: vi.fn(),
      aiCategoryDialogOpen: true,
      onToggleAiCategory: vi.fn(),
      onStartAiCategory,
      aiCategorySelection: ["category-1", "category-2"],
    });

    fireEvent.click(screen.getByRole("button", { name: "开始归类" }));

    expect(onStartAiCategory).toHaveBeenCalledOnce();
  });

  it("holds the run when the selection moved under the dialog", () => {
    renderToolbar({
      selectedCount: 5,
      categories: [dining],
      onOpenAiCategory: vi.fn(),
      aiCategoryDialogOpen: true,
      onToggleAiCategory: vi.fn(),
      onStartAiCategory: vi.fn(),
      aiCategorySelection: ["category-1", "category-2"],
      aiCategorySelectionChanged: true,
    });

    expect(screen.getByRole("button", { name: "开始归类" })).toBeDisabled();
  });
});
