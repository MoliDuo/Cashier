import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchEnhancedStats } from "@/modules/stats/queries";
import { StatsTab } from "@/modules/workspace/ui/StatsTab";
import type { Ledger } from "@/modules/ledger/contracts";
import { getDefaultLedger } from "tests/helpers/default-ledger";
import type { EnhancedStatsDto } from "@/modules/stats/contracts";
import { buildEnhancedStatsFixture } from "tests/helpers/stats-fixture";
import { WorkspaceStoreProvider, useWorkspaceStore } from "@/modules/workspace/store";

const { searchParamsState } = vi.hoisted(() => ({
  searchParamsState: { current: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsState.current,
  usePathname: () => "/stats",
}));

vi.mock("@/modules/stats/queries", () => ({
  fetchEnhancedStats: vi.fn(),
}));

const ledgerFixture: Ledger = {
  settings: { ...getDefaultLedger().settings, mainCurrency: "CNY" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const statsFixture = buildEnhancedStatsFixture();

function renderStatsTab(bookId?: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <StatsTab
        {...(bookId == null ? {} : { bookId })}
        ledger={ledgerFixture}
        today="2026-08-24"
        timeZone="Asia/Shanghai"
      />
    </QueryClientProvider>
  );
  return { queryClient, ...view };
}

describe("StatsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsState.current = new URLSearchParams();
    vi.mocked(fetchEnhancedStats).mockImplementation(async (input) => ({
      ...statsFixture,
      summary: {
        ...statsFixture.summary,
        total: input.bookId === "book-1" ? "40" : input.bookId === "book-2" ? "80" : "120",
      },
    }));
  });

  it("charts the book the page picked", async () => {
    const { rerender, queryClient } = renderStatsTab();
    await waitFor(() => expect(fetchEnhancedStats).toHaveBeenCalled());

    rerender(
      <QueryClientProvider client={queryClient}>
        <StatsTab
          bookId="book-2"
          ledger={ledgerFixture}
          today="2026-08-24"
          timeZone="Asia/Shanghai"
        />
      </QueryClientProvider>
    );
    await waitFor(() =>
      expect(
        vi.mocked(fetchEnhancedStats).mock.calls.some(([input]) => input.bookId === "book-2")
      ).toBe(true)
    );
  });

  it("drops the previous book's figures while the next book's query is pending", async () => {
    const { rerender, queryClient } = renderStatsTab("book-1");
    expect(await screen.findByText("¥40.00")).toBeInTheDocument();

    vi.mocked(fetchEnhancedStats).mockImplementation(() => new Promise<EnhancedStatsDto>(() => {}));
    rerender(
      <QueryClientProvider client={queryClient}>
        <StatsTab
          bookId="book-2"
          ledger={ledgerFixture}
          today="2026-08-24"
          timeZone="Asia/Shanghai"
        />
      </QueryClientProvider>
    );

    // The cached figures belong to the previous book and must not stand in for
    // book-2's.
    await waitFor(() =>
      expect(vi.mocked(fetchEnhancedStats).mock.calls.some(([input]) => input.bookId === "book-2"))
    );
    expect(screen.queryByText("¥40.00")).not.toBeInTheDocument();
    expect(screen.getByTestId("stats-visualization-skeleton")).toBeInTheDocument();
  });

  it("shows retry when the selected scope fails", async () => {
    vi.mocked(fetchEnhancedStats).mockRejectedValue(new Error("unavailable"));
    renderStatsTab();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("asks for the period in the URL and leaves its days to the server", async () => {
    searchParamsState.current = new URLSearchParams("range=week&offset=-1");
    renderStatsTab();

    await waitFor(() =>
      expect(fetchEnhancedStats).toHaveBeenCalledWith({ period: { range: "week", offset: -1 } })
    );
  });

  it("prints its own period and total in the phone's top bar, and folds the period bar there", async () => {
    searchParamsState.current = new URLSearchParams("range=year&offset=-1");
    function TopBarProbe() {
      const summary = useWorkspaceStore((state) => state.headerSummary);
      return <output data-testid="top-bar-summary">{JSON.stringify(summary)}</output>;
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceStoreProvider initialBookId={null}>
          <TopBarProbe />
          <StatsTab ledger={ledgerFixture} today="2026-08-24" timeZone="Asia/Shanghai" />
        </WorkspaceStoreProvider>
      </QueryClientProvider>
    );

    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId("top-bar-summary").textContent ?? "null")).toEqual({
        total: "¥120.00",
        period: "2025年",
        filtered: false,
        // Last year steps both ways from the top bar.
        steps: { back: true, forward: true },
      })
    );
    // On a phone the period bar waits behind the summary until it is tapped.
    expect(document.getElementById("ledger-list-controls")).toHaveClass("max-md:hidden");
  });
});
