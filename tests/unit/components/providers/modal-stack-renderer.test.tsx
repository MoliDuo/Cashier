import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModalStackRenderer } from "@/modules/workspace/ui/ModalStackRenderer";
import { useModalStackStore } from "@/lib/store/modal-stack";

vi.mock("@/modules/source-document/ui/SourceDocumentDetailWrapper", () => ({
  SourceDocumentDetailWrapper: ({
    open,
    onClose,
    onBack,
    onExitComplete,
  }: {
    open: boolean;
    onClose: () => void;
    onBack?: () => void;
    onExitComplete?: () => void;
  }) => (
    <div data-testid="detail-modal" data-open={open}>
      <button onClick={onClose}>close</button>
      {onBack != null && <button onClick={onBack}>back</button>}
      {!open && onExitComplete != null && <button onClick={onExitComplete}>exit complete</button>}
    </div>
  ),
}));

describe("ModalStackRenderer", () => {
  beforeEach(() => {
    useModalStackStore.setState({ stack: [] });
  });

  it("keeps the stack item mounted until its exit animation completes", async () => {
    render(
      <ModalStackRenderer books={[]} categories={[]} mainCurrency="CNY" preferredCurrencies={[]} />
    );
    act(() => {
      useModalStackStore.getState().push({
        type: "source-document",
        id: "document-1",
      });
    });

    fireEvent.click(await screen.findByRole("button", { name: "close" }));
    expect(useModalStackStore.getState().stack).toHaveLength(1);
    expect(screen.getByTestId("detail-modal")).toHaveAttribute("data-open", "false");

    fireEvent.click(screen.getByRole("button", { name: "exit complete" }));
    expect(useModalStackStore.getState().stack).toHaveLength(0);
  });

  it("can reopen the same item after its exit completes", async () => {
    render(
      <ModalStackRenderer books={[]} categories={[]} mainCurrency="CNY" preferredCurrencies={[]} />
    );
    const item = { type: "source-document" as const, id: "document-1" };

    act(() => useModalStackStore.getState().push(item));
    fireEvent.click(await screen.findByRole("button", { name: "close" }));
    fireEvent.click(screen.getByRole("button", { name: "exit complete" }));
    act(() => useModalStackStore.getState().push(item));

    expect(screen.getByTestId("detail-modal")).toHaveAttribute("data-open", "true");
  });

  it("returns to the previous detail only after the top exit completes", async () => {
    render(
      <ModalStackRenderer books={[]} categories={[]} mainCurrency="CNY" preferredCurrencies={[]} />
    );
    act(() => {
      useModalStackStore.getState().push({ type: "source-document", id: "document-1" });
      useModalStackStore.getState().push({ type: "source-document", id: "document-2" });
    });

    fireEvent.click(await screen.findByRole("button", { name: "back" }));
    expect(useModalStackStore.getState().stack).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "exit complete" }));

    expect(useModalStackStore.getState().stack).toEqual([
      { type: "source-document", id: "document-1" },
    ]);
    expect(screen.getByTestId("detail-modal")).toHaveAttribute("data-open", "true");
  });

  it("keeps lower wrappers mounted while only opening the top wrapper", async () => {
    render(
      <ModalStackRenderer books={[]} categories={[]} mainCurrency="CNY" preferredCurrencies={[]} />
    );
    act(() => {
      useModalStackStore.getState().push({ type: "source-document", id: "document-1" });
      useModalStackStore.getState().push({ type: "source-document", id: "document-2" });
    });

    const modals = screen.getAllByTestId("detail-modal");
    expect(modals).toHaveLength(2);
    expect(modals[0]).toHaveAttribute("data-open", "false");
    expect(modals[1]).toHaveAttribute("data-open", "true");

    fireEvent.click(screen.getByRole("button", { name: "back" }));
    fireEvent.click(screen.getByRole("button", { name: "exit complete" }));

    expect(useModalStackStore.getState().stack).toEqual([
      { type: "source-document", id: "document-1" },
    ]);
    expect(screen.getAllByTestId("detail-modal")).toHaveLength(1);
    expect(screen.getByTestId("detail-modal")).toHaveAttribute("data-open", "true");
  });

  it("focuses the page fallback when the original trigger was removed", async () => {
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    const fallback = document.createElement("main");
    fallback.tabIndex = -1;
    fallback.dataset.ledgerFocusFallback = "";
    document.body.appendChild(fallback);
    const removedTrigger = document.createElement("button");

    render(
      <ModalStackRenderer books={[]} categories={[]} mainCurrency="CNY" preferredCurrencies={[]} />
    );
    act(() => {
      useModalStackStore.getState().push({
        type: "source-document",
        id: "document-1",
        returnFocus: removedTrigger,
      });
    });

    fireEvent.click(await screen.findByRole("button", { name: "close" }));
    fireEvent.click(screen.getByRole("button", { name: "exit complete" }));

    expect(fallback).toHaveFocus();
    fallback.remove();
    requestAnimationFrame.mockRestore();
  });

  it("exits the top detail on back without asking", () => {
    useModalStackStore.getState().push({ type: "source-document", id: "document-1" });
    useModalStackStore.getState().push({ type: "source-document", id: "document-2" });
    render(
      <ModalStackRenderer books={[]} categories={[]} mainCurrency="CNY" preferredCurrencies={[]} />
    );
    fireEvent.click(screen.getByRole("button", { name: "back" }));
    expect(screen.getAllByTestId("detail-modal")[1]).toHaveAttribute("data-open", "false");
  });
});
