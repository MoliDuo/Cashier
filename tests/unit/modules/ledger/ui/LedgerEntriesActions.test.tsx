import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LedgerEntriesActions } from "@/modules/ledger/ui/batch-action-toolbar/LedgerEntriesActions";

type ActionsProps = React.ComponentProps<typeof LedgerEntriesActions>;

function renderActions(overrides: Partial<ActionsProps> = {}) {
  const props: ActionsProps = {
    disabled: false,
    onOpenCategory: vi.fn(),
    onOpenCurrency: vi.fn(),
    ...overrides,
  };
  return { ...render(<LedgerEntriesActions {...props} />), props };
}

describe("LedgerEntriesActions", () => {
  it("opens the category picker from its own button", async () => {
    const { props } = renderActions();

    await userEvent.click(screen.getByRole("button", { name: /设置分类|set category/i }));

    expect(props.onOpenCategory).toHaveBeenCalledOnce();
  });

  it("opens the currency picker from its own button", async () => {
    const { props } = renderActions();

    await userEvent.click(screen.getByRole("button", { name: /修改货币|set currency/i }));

    expect(props.onOpenCurrency).toHaveBeenCalledOnce();
  });

  it("opens nothing of its own: no action here is a menu", async () => {
    renderActions();

    await userEvent.click(screen.getByRole("button", { name: /设置分类|set category/i }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a running write on the button that started it", () => {
    renderActions({ isChangingCategory: true });

    const category = screen.getByRole("button", { name: /设置分类|set category/i });
    expect(category).toHaveAttribute("aria-busy", "true");
    expect(category).toBeDisabled();
    expect(screen.getByRole("button", { name: /修改货币|set currency/i })).toBeEnabled();
  });

  it("renders the optional split command only when provided", async () => {
    const onSplit = vi.fn();
    const { rerender } = render(<LedgerEntriesActions disabled={false} onSplit={onSplit} />);

    await userEvent.click(screen.getByRole("button", { name: /拆分|split/i }));
    expect(onSplit).toHaveBeenCalledOnce();

    rerender(<LedgerEntriesActions disabled={false} />);
    expect(screen.queryByRole("button", { name: /拆分|split/i })).not.toBeInTheDocument();
  });

  it("keeps the actions in one order", () => {
    renderActions({
      onChangeDate: vi.fn(),
      onSplit: vi.fn(),
      onRetry: vi.fn(),
      onDelete: vi.fn(),
    });

    // jsdom does not apply `display: none`, so a button with a mobile label
    // carries both spans here; the order is what this asserts. Category is one
    // button, not two: both answers are picked inside its dialog.
    const labels = screen.getAllByRole("button").map((button) => button.textContent ?? "");
    ["设置分类", "修改日期", "拆分", "重试", "修改货币", "删除"].forEach((label, index) => {
      expect(labels[index]).toContain(label);
    });
  });

  it("shows a classification run on the category button that started it", () => {
    renderActions({ isReclassifying: true });

    expect(screen.getByRole("button", { name: /设置分类|set category/i })).toHaveAttribute(
      "aria-busy",
      "true"
    );
  });

  it("keeps every action visible but unavailable with nothing to act on", () => {
    renderActions({ disabled: true, onChangeDate: vi.fn() });

    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });
});
