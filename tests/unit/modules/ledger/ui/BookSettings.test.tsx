import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/query-keys";
import type { BookDto } from "@/modules/ledger/contracts";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const { getBooksAction, getBooksIncludingArchivedAction } = vi.hoisted(() => ({
  getBooksAction: vi.fn(),
  getBooksIncludingArchivedAction: vi.fn(),
}));

vi.mock("@/lib/queries/ledger-query-client", () => ({
  getBooksAction,
  getBooksIncludingArchivedAction,
}));

vi.mock("@/modules/ledger/hooks/useBookMutations", () => ({
  useBookMutations: () => ({
    createBook: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    updateBook: { mutate: vi.fn(), isPending: false },
    reorderBooks: { mutate: vi.fn(), isPending: false },
    archiveBook: { mutate: vi.fn(), isPending: false },
    restoreBook: { mutate: vi.fn(), isPending: false },
    deleteBook: { mutate: vi.fn(), isPending: false },
  }),
}));

import { BookSettings } from "@/modules/ledger/ui/settings/BookSettings";

const LEDGER_ID = "ledger-1";
const LIVE: BookDto = {
  id: "book-1",
  ledgerId: LEDGER_ID,
  name: "共同支出",
  timeZone: null,
  sortOrder: 1,
  archivedAt: null,
};
const ARCHIVED: BookDto = {
  id: "book-2",
  ledgerId: LEDGER_ID,
  name: "旧旅行账本",
  timeZone: null,
  sortOrder: 2,
  archivedAt: "2026-02-01T00:00:00.000Z",
};

function renderBookSettings(props: { initialBooks?: readonly BookDto[] } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = render(<BookSettings ledgerId={LEDGER_ID} {...props} />, { wrapper });
  return { ...view, queryClient };
}

describe("设置 book list data range", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches the archived-inclusive list when 设置 was opened without one", async () => {
    getBooksIncludingArchivedAction.mockResolvedValue([LIVE, ARCHIVED]);
    renderBookSettings();

    // The workspace hands in the live books only, so the archived rows are
    // invisible until this query runs; seeding it with the live list would keep
    // the retired book hidden for the whole stale window.
    expect(await screen.findByText(ARCHIVED.name)).toBeInTheDocument();
    expect(screen.getByText(LIVE.name)).toBeInTheDocument();
    expect(getBooksIncludingArchivedAction).toHaveBeenCalledWith(LEDGER_ID);
    expect(getBooksAction).not.toHaveBeenCalled();
  });

  it("reuses a complete bootstrap list without asking again", () => {
    getBooksIncludingArchivedAction.mockResolvedValue([LIVE, ARCHIVED]);
    renderBookSettings({ initialBooks: [LIVE, ARCHIVED] });

    expect(screen.getByText(ARCHIVED.name)).toBeInTheDocument();
    expect(getBooksIncludingArchivedAction).not.toHaveBeenCalled();
  });

  it("shows a loading placeholder instead of the empty state while the list is in flight", () => {
    getBooksIncludingArchivedAction.mockReturnValue(new Promise(() => {}));
    renderBookSettings();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("empty")).not.toBeInTheDocument();
  });

  it("offers the empty state only once the list has really arrived empty", async () => {
    getBooksIncludingArchivedAction.mockResolvedValue([]);
    renderBookSettings();

    expect(await screen.findByText("empty")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("reports a first-load failure and refetches on retry", async () => {
    getBooksIncludingArchivedAction.mockRejectedValueOnce(new Error("offline"));
    renderBookSettings();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("empty")).not.toBeInTheDocument();

    getBooksIncludingArchivedAction.mockResolvedValue([LIVE, ARCHIVED]);
    fireEvent.click(screen.getByRole("button", { name: "retry" }));

    expect(await screen.findByText(ARCHIVED.name)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("keeps the list and reports a retry when a background refresh fails", async () => {
    getBooksIncludingArchivedAction.mockResolvedValue([LIVE, ARCHIVED]);
    const { queryClient } = renderBookSettings({ initialBooks: [LIVE, ARCHIVED] });
    expect(screen.getByText(LIVE.name)).toBeInTheDocument();

    getBooksIncludingArchivedAction.mockRejectedValue(new Error("offline"));
    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: queryKeys.booksIncludingArchived(LEDGER_ID),
      });
    });

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    // The failure is about the refresh, not about the data: what the reader
    // already had must stay on screen, and it must not fall back to "no books".
    expect(screen.getByText(LIVE.name)).toBeInTheDocument();
    expect(screen.getByText(ARCHIVED.name)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText("empty")).not.toBeInTheDocument();
  });
});
