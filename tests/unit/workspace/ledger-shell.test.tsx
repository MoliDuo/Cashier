import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { activeTabState, navigateMock, routerPrefetchMock, toastError, prefetchStatsTabQueryMock } =
  vi.hoisted(() => ({
    activeTabState: { current: "stream" as string },
    navigateMock: vi.fn(),
    routerPrefetchMock: vi.fn(),
    toastError: vi.fn(),
    prefetchStatsTabQueryMock: vi.fn(),
  }));

vi.mock("sonner", () => ({ toast: { error: toastError } }));

vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>();
  return {
    ...actual,
    useTranslations: () => (key: string) => key,
    useLocale: () => "en",
  };
});

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
  AppShell: ({ children, navigation }: { children: ReactNode; navigation?: ReactNode }) => (
    <>
      {navigation}
      {children}
    </>
  ),
}));

vi.mock("@/modules/workspace/ui/SwipeTabSurface", () => ({
  SwipeTabSurface: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/modules/workspace/ui/NewRecordForms", () => ({ preloadNewRecordModules: vi.fn() }));

vi.mock("@/modules/workspace/prefetch-ledger-tabs", () => ({
  prefetchDetailsTabQuery: vi.fn(),
  prefetchStatsTabQuery: prefetchStatsTabQueryMock,
}));

import { LedgerShell } from "@/app/(protected)/(ledger)/_shell";
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

/** The destination's own sr-only status joins its label while a refresh runs. */
function destination(name: string) {
  return screen.getByRole("button", { name: new RegExp(`^${name}\\b`) });
}

describe("LedgerShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeTabState.current = "stream";
  });

  it("refetches the tab the reader is already on rather than navigating to it", async () => {
    const user = userEvent.setup();
    const stream = vi.fn().mockResolvedValue("stream");
    renderShell(["ledger", "source-documents", "stream"], stream);
    await waitFor(() => expect(destination("stream")).toBeEnabled());

    await user.click(destination("stream"));

    await waitFor(() => expect(stream).toHaveBeenCalledTimes(2));
    expect(navigateMock).not.toHaveBeenCalled();
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

  it("refreshes 设置 like any other tab, since it holds nothing unsaved", async () => {
    const user = userEvent.setup();
    activeTabState.current = "settings";
    const settings = vi.fn().mockResolvedValue("settings");
    renderShell(["ledger", "settings"], settings);
    await waitFor(() => expect(destination("settings")).toBeEnabled());

    await user.click(destination("settings"));

    await waitFor(() => expect(settings).toHaveBeenCalledTimes(2));
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("reports a refresh that failed, so a stale tab is not read as a fresh one", async () => {
    const user = userEvent.setup();
    const stream = vi.fn().mockResolvedValueOnce("stream").mockRejectedValue(new Error("offline"));
    renderShell(["ledger", "source-documents", "stream"], stream);
    await waitFor(() => expect(destination("stream")).toBeEnabled());

    await user.click(destination("stream"));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("refreshFailed"));
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
});
