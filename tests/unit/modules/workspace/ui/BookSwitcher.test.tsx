import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BookDto } from "@/modules/ledger/contracts";

const booksState = vi.hoisted(() => ({ current: undefined as BookDto[] | undefined }));

vi.mock("@/modules/ledger/hooks/useBooks", () => ({
  useBooks: () => ({ books: booksState.current }),
}));

import { BookSwitcher } from "@/modules/workspace/ui/BookSwitcher";
import { WorkspaceStoreProvider, useWorkspaceStore } from "@/modules/workspace/store";

const shared: BookDto = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "共同支出",
  sortOrder: 0,
  archivedAt: null,
};
const travel: BookDto = {
  id: "10000000-0000-4000-8000-000000000002",
  name: "旅行支出",
  sortOrder: 1,
  archivedAt: null,
};

function StoredScope() {
  return <output>{useWorkspaceStore((state) => state.bookId) ?? "all"}</output>;
}

function renderSwitcher(initialBookId: string | null) {
  return render(
    <WorkspaceStoreProvider initialBookId={initialBookId}>
      <BookSwitcher />
      <StoredScope />
    </WorkspaceStoreProvider>
  );
}

describe("BookSwitcher", () => {
  beforeEach(() => {
    booksState.current = [shared, travel];
  });

  it("names 总账 when no book is being viewed", () => {
    renderSwitcher(null);
    expect(screen.getByRole("button", { name: "分账：总账" })).toBeEnabled();
  });

  it("names the remembered book once the books have loaded, and waits until then", () => {
    booksState.current = undefined;
    const { rerender } = renderSwitcher(travel.id);
    expect(screen.getByRole("button", { name: "分账：…" })).toBeDisabled();

    booksState.current = [shared, travel];
    rerender(
      <WorkspaceStoreProvider initialBookId={travel.id}>
        <BookSwitcher />
        <StoredScope />
      </WorkspaceStoreProvider>
    );
    expect(screen.getByRole("button", { name: "分账：旅行支出" })).toBeInTheDocument();
  });

  it("lists 总账 then the books, and picking one makes it the scope", async () => {
    const user = userEvent.setup();
    renderSwitcher(null);

    await user.click(screen.getByRole("button", { name: "分账：总账" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "总账",
      "共同支出",
      "旅行支出",
    ]);
    await user.click(screen.getByRole("menuitem", { name: "旅行支出" }));

    expect(screen.getByRole("status")).toHaveTextContent(travel.id);
    expect(screen.getByRole("button", { name: "分账：旅行支出" })).toBeInTheDocument();
  });

  it("offers nothing to switch between for a ledger with no books", () => {
    booksState.current = [];
    renderSwitcher(null);
    expect(screen.queryByRole("button", { name: /^分账/ })).not.toBeInTheDocument();
  });
});
