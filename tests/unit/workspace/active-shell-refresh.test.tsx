import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { activeTabState, dirtyState, handleTabChangeMock, toastError } = vi.hoisted(() => ({
  activeTabState: { current: "stream" as string },
  dirtyState: { current: false },
  handleTabChangeMock: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/ledgers/ledger-1",
  useSearchParams: () => new URLSearchParams(),
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

vi.mock("@/modules/workspace/hooks/useLedgerTabs", () => ({
  useLedgerTabs: () => ({
    activeTab: activeTabState.current,
    handleTabChange: handleTabChangeMock,
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

// Hovering or pressing a destination preloads its tab's code without awaiting
// it. The real tabs pull in most of the app, and an import still in flight when
// the file ends fails the run after every test has passed.
vi.mock("@/modules/workspace/ui/DetailsTab", () => ({ DetailsTab: () => null }));
vi.mock("@/modules/workspace/ui/StatsTab", () => ({ StatsTab: () => null }));
vi.mock("@/modules/ledger/ui/SettingsTab", () => ({ SettingsTab: () => null }));

vi.mock("@/modules/workspace/prefetch-ledger-tabs", () => ({
  prefetchDetailsTabQuery: vi.fn(),
  prefetchStatsTabQuery: vi.fn(),
}));

vi.mock("@/modules/ledger/hooks/useSettingsLeaveGuard", () => ({
  useSettingsLeaveGuard: () => ({
    hasDirtyChanges: dirtyState.current,
    leaveConfirmOpen: false,
    attemptLeave: (run: () => void) => run(),
    confirmLeave: vi.fn(),
    cancelLeave: vi.fn(),
  }),
}));

import { ActiveShell } from "@/app/(protected)/_active-shell";
import { useShellController } from "@/components/providers/shell-controller";

/**
 * Stands in for the tab content: it holds the tab's query, and it registers the
 * new-record handler the shell waits on before it enables its destinations.
 */
function TabContent({ queryKey, queryFn }: { queryKey: string[]; queryFn: () => Promise<string> }) {
  const { registerOpenInput } = useShellController();
  useEffect(() => registerOpenInput(() => {}), [registerOpenInput]);
  useQuery({ queryKey, queryFn });
  return null;
}

function renderShell(queryKey: string[], queryFn: () => Promise<string>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ActiveShell ledgerId="ledger-1">
        <TabContent queryKey={queryKey} queryFn={queryFn} />
      </ActiveShell>
    </QueryClientProvider>
  );
}

/** The destination's own sr-only status joins its label while a refresh runs. */
function destination(name: string) {
  return screen.getByRole("button", { name: new RegExp(`^${name}\\b`) });
}

describe("ActiveShell tab refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeTabState.current = "stream";
    dirtyState.current = false;
  });

  it("refetches the tab the reader is already on rather than navigating to it", async () => {
    const user = userEvent.setup();
    const stream = vi.fn().mockResolvedValue("stream");
    renderShell(["ledger", "ledger-1", "source-documents", "stream"], stream);
    await waitFor(() => expect(destination("stream")).toBeEnabled());

    await user.click(destination("stream"));

    await waitFor(() => expect(stream).toHaveBeenCalledTimes(2));
    expect(handleTabChangeMock).not.toHaveBeenCalled();
  });

  it("still navigates when the destination is another tab", async () => {
    const user = userEvent.setup();
    const stream = vi.fn().mockResolvedValue("stream");
    renderShell(["ledger", "ledger-1", "source-documents", "stream"], stream);
    await waitFor(() => expect(destination("stats")).toBeEnabled());

    await user.click(destination("stats"));

    expect(handleTabChangeMock).toHaveBeenCalledWith("stats");
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("leaves 设置 alone while it is holding unsaved edits, which a refetch would drop", async () => {
    const user = userEvent.setup();
    activeTabState.current = "settings";
    dirtyState.current = true;
    const settings = vi.fn().mockResolvedValue("settings");
    renderShell(["ledger", "ledger-1", "settings"], settings);
    await waitFor(() => expect(destination("settings")).toBeEnabled());

    await user.click(destination("settings"));

    expect(settings).toHaveBeenCalledTimes(1);
    expect(handleTabChangeMock).not.toHaveBeenCalled();
  });

  it("reports a refresh that failed, so a stale tab is not read as a fresh one", async () => {
    const user = userEvent.setup();
    const stream = vi.fn().mockResolvedValueOnce("stream").mockRejectedValue(new Error("offline"));
    renderShell(["ledger", "ledger-1", "source-documents", "stream"], stream);
    await waitFor(() => expect(destination("stream")).toBeEnabled());

    await user.click(destination("stream"));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("refreshFailed"));
  });
});
