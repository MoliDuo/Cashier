import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
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

vi.mock("@/i18n/routing", () => ({
  usePathname: () => "/ledgers/ledger-1",
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

vi.mock("@/modules/workspace/prefetch-ledger-tabs", () => ({
  prefetchDetailsTabQuery: prefetchDetailsTabQueryMock,
  prefetchStatsTabQuery: prefetchStatsTabQueryMock,
}));

vi.mock("@/i18n/use-feature-messages", () => ({
  preloadFeatureMessages: vi.fn(),
}));

vi.mock("@/modules/ledger/hooks/useSettingsLeaveGuard", () => ({
  useSettingsLeaveGuard: () => ({
    leaveConfirmOpen: false,
    attemptLeave: (run: () => void) => run(),
    confirmLeave: vi.fn(),
    cancelLeave: vi.fn(),
  }),
}));

import { ActiveShell } from "@/app/[locale]/(protected)/_active-shell";

const BOOK_ID = "10000000-0000-4000-8000-000000000001";

describe("ActiveShell tab-hover prefetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsState.current = new URLSearchParams();
    onTabIntentRef.current = null;
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

  it("reads the viewed book out of the URL, so a client-side book switch reaches the prefetch", async () => {
    const { rerender } = renderShell();
    // The scope change is a history update from LedgerPageClient with no server
    // render behind it: the shell has to read the live URL, not a prop captured
    // at hydration. useSearchParams re-renders the shell on the change, which is
    // what this rerender stands in for.
    searchParamsState.current = new URLSearchParams(`bookId=${BOOK_ID}`);
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

  it("prefetches 总账 with no book when the URL holds none", async () => {
    renderShell();

    onTabIntentRef.current?.("stats");

    await waitFor(() => expect(prefetchStatsTabQueryMock).toHaveBeenCalled());
    expect(prefetchStatsTabQueryMock.mock.calls.at(-1)?.[2]).toBeUndefined();
  });
});
