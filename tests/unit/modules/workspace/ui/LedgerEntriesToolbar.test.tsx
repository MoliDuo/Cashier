import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PeriodParams } from "@/lib/period-utils";
import type { BatchEntryDateImpact } from "@/modules/ledger/application/ports";
import { LedgerEntriesToolbar } from "@/modules/workspace/ui/LedgerEntriesToolbar";

const defaultPeriodParams: PeriodParams = { period: "thisMonth" };

const defaultProps = {
  isSelectionMode: false,
  isAllSelected: false,
  selectedCount: 0,
  queryFingerprint: "query-1",
  onToggleSelectionMode: vi.fn(),
  onSelectAll: vi.fn(),
  onClearSelection: vi.fn(),
  filters: {} as const,
  onFiltersChange: vi.fn(),
  periodParams: defaultPeriodParams,
  mainCurrency: "CNY",
  filteredTotal: "123.45",
};

describe("LedgerEntriesToolbar", () => {
  it("names the span the total covers", () => {
    render(<LedgerEntriesToolbar {...defaultProps} />);

    expect(screen.getByText("本月")).toBeInTheDocument();
    expect(screen.getByText("¥123.45")).toBeInTheDocument();
  });

  it("prints the two days of a range the panel cannot name", () => {
    render(
      <LedgerEntriesToolbar
        {...defaultProps}
        periodParams={{ period: "custom", startDate: "2026-09-01", endDate: "2026-09-10" }}
      />
    );

    expect(screen.getByText(/9月1日/)).toBeInTheDocument();
    expect(screen.getByText(/9月10日/)).toBeInTheDocument();
  });

  it("shows selection controls instead of totals and filters while selecting", () => {
    render(<LedgerEntriesToolbar {...defaultProps} isSelectionMode={true} selectedCount={3} />);

    expect(screen.getByText("全选已加载的 3 条")).toBeInTheDocument();
    expect(screen.queryByText(/已选择/)).not.toBeInTheDocument();
    expect(screen.getByTitle("取消")).toBeInTheDocument();
    expect(screen.queryByText("¥123.45")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选" })).not.toBeInTheDocument();
  });

  it("offers select all before anything is selected", () => {
    render(<LedgerEntriesToolbar {...defaultProps} isSelectionMode={true} selectedCount={0} />);

    const master = screen.getByRole("checkbox");
    expect(master).toBeEnabled();

    fireEvent.click(master);
    expect(defaultProps.onSelectAll).toHaveBeenCalled();
  });

  it("stops offering refresh once the box carries selection controls", () => {
    const { rerender } = render(<LedgerEntriesToolbar {...defaultProps} onRefresh={vi.fn()} />);

    expect(screen.getByTestId("toolbar-refresh-hint")).toBeInTheDocument();

    rerender(
      <LedgerEntriesToolbar
        {...defaultProps}
        onRefresh={vi.fn()}
        isSelectionMode={true}
        selectedCount={1}
      />
    );

    expect(screen.queryByTestId("toolbar-refresh-hint")).not.toBeInTheDocument();
  });

  it("keeps active status details inside the filter panel", () => {
    render(<LedgerEntriesToolbar {...defaultProps} filters={{ statuses: ["completed"] }} />);

    expect(screen.queryByText(/状态：/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已启用 1 个筛选" })).toBeDefined();
  });

  it("names the book a narrowed list is showing, and offers the switcher back", () => {
    render(<LedgerEntriesToolbar {...defaultProps} scopeBookName="B" />);

    expect(screen.getByTestId("book-scope-chip")).toHaveTextContent("仅看 B");
    expect(screen.queryByRole("group", { name: "分账" })).not.toBeInTheDocument();
  });

  it("renders the amount without a redundant label when the prefix is gone", () => {
    render(<LedgerEntriesToolbar {...defaultProps} />);

    expect(screen.getByText("¥123.45")).toBeInTheDocument();
    expect(screen.queryByText(/Filtered total/i)).not.toBeInTheDocument();
  });

  it("asks for the date and the impact in one dialog", async () => {
    const onUpdateDates = vi.fn();
    let answerPreview: (impact: BatchEntryDateImpact) => void = () => {};
    const onPreviewDateImpact = vi.fn(
      () =>
        new Promise<BatchEntryDateImpact>((resolve) => {
          answerPreview = resolve;
        })
    );
    render(
      <LedgerEntriesToolbar
        {...defaultProps}
        isSelectionMode
        selectedCount={1}
        selectedSourceDocumentIds={["document-1"]}
        selectedEntryIds={["entry-1"]}
        onUpdateDates={onUpdateDates}
        onPreviewDateImpact={onPreviewDateImpact}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /修改日期/ }));

    // The dialog is up before the preview answers, and fills in behind it.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认" })).toBeDisabled();

    answerPreview({
      selectedEntryCount: 1,
      sourceDocumentCount: 1,
      affectedEntryCount: 1,
      sourceDocumentIds: ["document-1"],
    });

    await waitFor(() => expect(onPreviewDateImpact).toHaveBeenCalledOnce());
    expect(await screen.findByText(/将影响 1 张单据和 1 条分录/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() =>
      expect(onUpdateDates).toHaveBeenCalledWith(expect.any(String), ["document-1"])
    );
  });

  it("blocks date confirmation when the selection query changes after preview", async () => {
    const onUpdateDates = vi.fn();
    const onPreviewDateImpact = vi.fn().mockResolvedValue({
      selectedEntryCount: 1,
      sourceDocumentCount: 1,
      affectedEntryCount: 1,
    });
    const { rerender } = render(
      <LedgerEntriesToolbar
        {...defaultProps}
        isSelectionMode
        selectedCount={1}
        selectedSourceDocumentIds={["document-1"]}
        selectedEntryIds={["entry-1"]}
        onUpdateDates={onUpdateDates}
        onPreviewDateImpact={onPreviewDateImpact}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /修改日期/ }));
    await waitFor(() => expect(onPreviewDateImpact).toHaveBeenCalledOnce());

    rerender(
      <LedgerEntriesToolbar
        {...defaultProps}
        queryFingerprint="query-2"
        isSelectionMode
        selectedCount={1}
        selectedSourceDocumentIds={["document-1"]}
        selectedEntryIds={["entry-1"]}
        onUpdateDates={onUpdateDates}
        onPreviewDateImpact={onPreviewDateImpact}
      />
    );

    expect(screen.getByText("所选项目已变化，请重新预览日期影响。")).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "确认" });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onUpdateDates).not.toHaveBeenCalled();
  });
});
