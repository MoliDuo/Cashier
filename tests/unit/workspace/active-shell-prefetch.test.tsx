import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const { searchParamsState, onTabIntentRef } = vi.hoisted(() => ({
  searchParamsState: { current: new URLSearchParams() },
  onTabIntentRef: { current: null as ((tab: string) => void) | null },
}));

const prefetchDetailsTabQueryMock = vi.hoisted(() => vi.fn());
const prefetchStatsTabQueryMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: () => "/ledgers/ledger-1",
  useSearchParams: () => searchParamsState.current,
}));

vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>();
  return {
    ...actual,
    useTranslations: () => (key: string) => key,
    useLocale: () => "en",
  };
});

vi.mock("@/modules/workspace/hooks/useLedgerTabs", () => ({
  useLedgerTabs: () => ({ activeTab: "stream", handleTabChange: vi.fn() }),
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

vi.mock("@/modules/workspace/ui/TabNavigation", () => ({
  TabNavigation: (props: { onTabIntent?: (tab: string) => void }) => {
    onTabIntentRef.current = props.onTabIntent ?? null;
    return null;
  },
}));

// Hovering or pressing a destination preloads its tab's code without awaiting
// it. The real tabs pull in most of the app, and an import still in flight when
// the file ends fails the run after every test has passed.
vi.mock("@/modules/workspace/ui/DetailsTab", () => ({ DetailsTab: () => null }));
vi.mock("@/modules/workspace/ui/StatsTab", () => ({ StatsTab: () => null }));
vi.mock("@/modules/ledger/ui/SettingsTab", () => ({ SettingsTab: () => null }));

vi.mock("@/modules/workspace/prefetch-ledger-tabs", () => ({
  prefetchDetailsTabQuery: prefetchDetailsTabQueryMock,
  prefetchStatsTabQuery: prefetchStatsTabQueryMock,
}));

vi.mock("@/modules/ledger/hooks/useSettingsLeaveGuard", () => ({
  useSettingsLeaveGuard: () => ({
    leaveConfirmOpen: false,
    attemptLeave: (run: () => void) => run(),
    confirmLeave: vi.fn(),
    cancelLeave: vi.fn(),
  }),
}));

import { ActiveShell } from "@/app/(protected)/_active-shell";
import { useBookScopeStore } from "@/lib/store/book-scope";

const BOOK_ID = "10000000-0000-4000-8000-000000000001";

describe("ActiveShell tab-hover prefetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsState.current = new URLSearchParams();
    onTabIntentRef.current = null;
    useBookScopeStore.getState().setBookId(null);
  });

  function renderShell() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const shell = (
      <QueryClientProvider client={queryClient}>
        <ActiveShell ledgerId="ledger-1">
          <div />
        </ActiveShell>
      </QueryClientProvider>
    );
    return render(shell);
  }

  it("reads the viewed book out of the shared scope store, so a client-side book switch reaches the prefetch", async () => {
    const { rerender } = renderShell();
    // The scope change is a store update from LedgerPageClient with no server
    // render behind it: the shell has to read the store, not a prop captured
    // at hydration. The store subscription re-renders the shell on the change,
    // which is what this rerender stands in for.
    act(() => useBookScopeStore.getState().setBookId(BOOK_ID));
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ActiveShell ledgerId="ledger-1">
          <div />
        </ActiveShell>
      </QueryClientProvider>
    );

    onTabIntentRef.current?.("stats");

    await waitFor(() => expect(prefetchStatsTabQueryMock).toHaveBeenCalled());
    expect(prefetchStatsTabQueryMock.mock.calls.at(-1)?.[2]).toBe(BOOK_ID);
  });

  it("prefetches 总账 with no book when the store holds none", async () => {
    renderShell();

    onTabIntentRef.current?.("stats");

    await waitFor(() => expect(prefetchStatsTabQueryMock).toHaveBeenCalled());
    expect(prefetchStatsTabQueryMock.mock.calls.at(-1)?.[2]).toBeUndefined();
  });
});
