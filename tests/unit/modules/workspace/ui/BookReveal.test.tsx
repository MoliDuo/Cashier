import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookReveal } from "@/modules/workspace/ui/BookReveal";
import { useBookRevealStore } from "@/lib/store/book-reveal";
import type { BookDto } from "@/modules/ledger/contracts";

const books: BookDto[] = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    ledgerId: "ledger-1",
    name: "共同支出",
    timeZone: null,
    sortOrder: 1,
    archivedAt: null,
  },
];

describe("BookReveal", () => {
  afterEach(() => {
    useBookRevealStore.setState({ open: false });
    vi.restoreAllMocks();
  });

  it("keeps the strip out of the tab order while it is closed", () => {
    render(<BookReveal books={books} scope={null} onScopeChange={vi.fn()} />);

    const strip = screen.getByTestId("book-reveal");
    expect(strip).toHaveAttribute("data-pull-reveal", "closed");
    expect(strip).toHaveAttribute("inert");
  });

  it("does not steal focus when the gesture opens the strip", async () => {
    render(<BookReveal books={books} scope={null} onScopeChange={vi.fn()} />);
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();

    useBookRevealStore.getState().setOpen(true);

    await waitFor(() =>
      expect(screen.getByTestId("book-reveal")).toHaveAttribute("data-pull-reveal", "open")
    );
    expect(outside).toHaveFocus();
    outside.remove();
  });

  it("closes on Escape without moving focus", async () => {
    render(<BookReveal books={books} scope={null} onScopeChange={vi.fn()} />);
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();

    useBookRevealStore.getState().setOpen(true);
    await waitFor(() =>
      expect(screen.getByTestId("book-reveal")).toHaveAttribute("data-pull-reveal", "open")
    );

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.getByTestId("book-reveal")).toHaveAttribute("data-pull-reveal", "closed")
    );
    expect(outside).toHaveFocus();
    outside.remove();
  });
});
