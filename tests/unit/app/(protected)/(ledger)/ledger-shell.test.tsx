import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { activeTabState, navigateMock, routerPrefetchMock, prefetchStatsTabQueryMock } = vi.hoisted(
  () => ({
    activeTabState: { current: "records" as string },
    navigateMock: vi.fn(),
    routerPrefetchMock: vi.fn(),
    prefetchStatsTabQueryMock: vi.fn(),
  })
);

vi.mock("@/modules/workspace/hooks/useLedgerNavigation", () => ({
  useLedgerNavigation: () => ({
    activeTab: activeTabState.current,
    hrefFor: (tab: string) => `/${tab}`,
    navigate: navigateMock,
    prefetch: routerPrefetchMock,
  }),
}));

vi.mock("@/modules/workspace/hooks/useTabScrollRestoration", () => ({
  useTabScrollRestoration: () => {},
}));

vi.mock("@/modules/workspace/ui/AppShell", () => ({
  AppShell: ({
    children,
    topBar,
    bottomBar,
  }: {
    children: ReactNode;
    topBar: ReactNode;
    bottomBar: ReactNode;
  }) => (
    <>
      <div data-testid="top-bar">{topBar}</div>
      <div data-testid="bottom-bar">{bottomBar}</div>
      {children}
    </>
  ),
}));

vi.mock("@/modules/workspace/ui/BookSwitcher", () => ({ BookSwitcher: () => null }));

vi.mock("@/modules/workspace/ui/NewRecordForms", () => ({ preloadNewRecordModules: vi.fn() }));

vi.mock("@/modules/workspace/prefetch-ledger-tabs", () => ({
  prefetchDetailsTabQuery: vi.fn(),
  prefetchStatsTabQuery: prefetchStatsTabQueryMock,
}));

import { LedgerShell } from "@/app/(protected)/(ledger)/_shell";
import { EntriesToolbarShell } from "@/modules/workspace/ui/EntriesToolbarShell";
import { ledgerPageCopy } from "@/copy/app";
import type { LedgerTab } from "@/lib/ledger-tabs";
import { WorkspaceStoreProvider, useWorkspaceStore } from "@/modules/workspace/store";

const BOOK_ID = "10000000-0000-4000-8000-000000000001";

/**
 * Stands in for the route: it holds the route's query, and it marks the
 * workspace ready, which the shell waits on before it enables its destinations.
 */
function RouteContent({
  queryKey,
  queryFn,
}: {
  queryKey: string[];
  queryFn: () => Promise<string>;
}) {
  const setReady = useWorkspaceStore((state) => state.setReady);
  useEffect(() => setReady(true), [setReady]);
  useQuery({ queryKey, queryFn });
  return null;
}

/** A book switch is a store update with no server render behind it. */
function BookSwitch() {
  const setBookId = useWorkspaceStore((state) => state.setBookId);
  return (
    <button type="button" onClick={() => setBookId(BOOK_ID)}>
      switch-book
    </button>
  );
}

function renderShell(
  queryKey: string[] = ["ledger", "source-documents", "stream"],
  queryFn: () => Promise<string> = vi.fn().mockResolvedValue("stream")
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceStoreProvider initialBookId={null}>
        <BookSwitch />
        <LedgerShell>
          <RouteContent queryKey={queryKey} queryFn={queryFn} />
        </LedgerShell>
      </WorkspaceStoreProvider>
    </QueryClientProvider>
  );
}

/** A tab on the phone's bottom bar; the desktop top bar carries the same two. */
function destination(tab: Exclude<LedgerTab, "settings">) {
  return within(screen.getByTestId("bottom-bar")).getByRole("button", {
    name: ledgerPageCopy[tab],
  });
}

/** A list's toolbar as 账目 renders it: browsed, or selected from. */
function BrowsedList({ filtered = false, selecting = false }) {
  return (
    <EntriesToolbarShell
      totalLabel={selecting ? undefined : "¥10,800.33"}
      browsing={selecting ? undefined : { period: "2026年9月", filtered }}
    >
      {null}
    </EntriesToolbarShell>
  );
}

describe("LedgerShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeTabState.current = "records";
  });

  it("does nothing when the destination is the tab the reader is on", async () => {
    const user = userEvent.setup();
    const stream = vi.fn().mockResolvedValue("stream");
    renderShell(["ledger", "source-documents", "stream"], stream);
    await waitFor(() => expect(destination("records")).toBeEnabled());

    await user.click(destination("records"));

    expect(navigateMock).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("navigates when the destination is another tab", async () => {
    const user = userEvent.setup();
    const stream = vi.fn().mockResolvedValue("stream");
    renderShell(["ledger", "source-documents", "stream"], stream);
    await waitFor(() => expect(destination("stats")).toBeEnabled());

    await user.click(destination("stats"));

    expect(navigateMock).toHaveBeenCalledWith("stats");
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("prefetches a hovered route for the book being viewed now", async () => {
    const user = userEvent.setup();
    renderShell();
    await waitFor(() => expect(destination("stats")).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "switch-book" }));
    await user.hover(destination("stats"));

    await waitFor(() => expect(prefetchStatsTabQueryMock).toHaveBeenCalled());
    expect(prefetchStatsTabQueryMock.mock.calls.at(-1)?.[1]).toBe(BOOK_ID);
    expect(routerPrefetchMock).toHaveBeenCalledWith("/stats");
  });

  it("prefetches 总账 with no book when none is viewed", async () => {
    const user = userEvent.setup();
    renderShell();
    await waitFor(() => expect(destination("stats")).toBeEnabled());

    await user.hover(destination("stats"));

    await waitFor(() => expect(prefetchStatsTabQueryMock).toHaveBeenCalled());
    expect(prefetchStatsTabQueryMock.mock.calls.at(-1)?.[1]).toBeUndefined();
  });

  it("opens 设置 from the gear, not from a tab", async () => {
    const user = userEvent.setup();
    renderShell();
    const gear = within(screen.getByTestId("top-bar")).getByRole("link", { name: "设置" });
    await waitFor(() => expect(destination("stats")).toBeEnabled());

    await user.click(gear);

    expect(navigateMock).toHaveBeenCalledWith("settings");
  });

  it("goes back from 设置 to the tab it was opened from", async () => {
    const user = userEvent.setup();
    activeTabState.current = "settings";
    renderShell();
    const back = within(screen.getByTestId("top-bar")).getByRole("button", { name: "返回" });
    await waitFor(() => expect(back).toBeEnabled());

    await user.click(back);

    expect(navigateMock).toHaveBeenCalledWith("records");
  });

  it("warms every other route once the ledger is up", async () => {
    renderShell();

    await waitFor(() => expect(routerPrefetchMock).toHaveBeenCalledWith("/stats"));
    expect(routerPrefetchMock).toHaveBeenCalledWith("/settings");
    expect(routerPrefetchMock).not.toHaveBeenCalledWith("/records");
  });

  it("prints the list's summary in the top bar while the list is browsed", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const renderWith = (list: ReactNode) => (
      <QueryClientProvider client={queryClient}>
        <WorkspaceStoreProvider initialBookId={null}>
          <LedgerShell>{list}</LedgerShell>
        </WorkspaceStoreProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(renderWith(<BrowsedList />));
    const topBar = within(screen.getByTestId("top-bar"));

    expect(topBar.getByText("¥10,800.33")).toBeInTheDocument();
    expect(topBar.getByText("2026年9月")).toBeInTheDocument();

    rerender(renderWith(<BrowsedList filtered />));
    expect(topBar.getByText(`2026年9月 · ${ledgerPageCopy.filtered}`)).toBeInTheDocument();

    // Selecting keeps its bar on the page, so the summary steps aside.
    rerender(renderWith(<BrowsedList selecting />));
    expect(topBar.queryByText("¥10,800.33")).not.toBeInTheDocument();

    rerender(renderWith(null));
    expect(topBar.queryByText("¥10,800.33")).not.toBeInTheDocument();
  });

  it("drops the list's controls down from the summary and folds them again", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceStoreProvider initialBookId={null}>
          <LedgerShell>
            <BrowsedList />
          </LedgerShell>
        </WorkspaceStoreProvider>
      </QueryClientProvider>
    );
    const summary = within(screen.getByTestId("top-bar")).getByRole("button", {
      name: /¥10,800\.33/,
    });
    const toolbar = screen.getByTestId("entries-toolbar");
    expect(summary).toHaveAttribute("aria-controls", toolbar.id);
    expect(summary).toHaveAttribute("aria-expanded", "false");
    expect(toolbar).toHaveClass("max-md:hidden");

    await user.click(summary);
    expect(summary).toHaveAttribute("aria-expanded", "true");
    expect(toolbar).not.toHaveClass("max-md:hidden");
    expect(toolbar).toHaveClass("max-md:fixed");

    await user.keyboard("{Escape}");
    expect(summary).toHaveAttribute("aria-expanded", "false");

    await user.click(summary);
    await user.click(summary);
    expect(summary).toHaveAttribute("aria-expanded", "false");
  });

  it("leaves the summary out of 设置's bar", () => {
    activeTabState.current = "settings";
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceStoreProvider initialBookId={null}>
          <LedgerShell>
            <BrowsedList />
          </LedgerShell>
        </WorkspaceStoreProvider>
      </QueryClientProvider>
    );

    expect(within(screen.getByTestId("top-bar")).queryByText("¥10,800.33")).not.toBeInTheDocument();
  });
});
