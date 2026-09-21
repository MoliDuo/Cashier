import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEnhancedStats } from "@/lib/queries/ledger-query-client";
import { StatsTab } from "@/modules/workspace/ui/StatsTab";
import type { Ledger } from "@/modules/ledger/contracts";
import { getDefaultLedger } from "tests/helpers/default-ledger";
import type { EnhancedStatsDto } from "@/modules/stats/contracts";
import { buildEnhancedStatsFixture } from "tests/helpers/stats-fixture";

const { searchParamsState } = vi.hoisted(() => ({
  searchParamsState: { current: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsState.current,
}));

vi.mock("@/i18n/routing", () => ({
  usePathname: () => "/ledgers/ledger-1",
}));

vi.mock("@/lib/queries/ledger-query-client", () => ({
  getEnhancedStats: vi.fn(),
}));

const ledgerFixture: Ledger = {
  id: "ledger-1",
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
        ledgerId="ledger-1"
        {...(bookId == null ? {} : { bookId })}
        ledger={ledgerFixture}
        ledgerToday="2026-08-24"
      />
    </QueryClientProvider>
  );
  return { queryClient, ...view };
}

describe("StatsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsState.current = new URLSearchParams();
    vi.mocked(getEnhancedStats).mockImplementation(async (input) => ({
      ...statsFixture,
      summary: {
        ...statsFixture.summary,
        total: input.bookId === "book-1" ? "40" : input.bookId === "book-2" ? "80" : "120",
      },
    }));
  });

  it("charts the book the page picked", async () => {
    const { rerender, queryClient } = renderStatsTab();
    await waitFor(() => expect(getEnhancedStats).toHaveBeenCalled());

    rerender(
      <QueryClientProvider client={queryClient}>
        <StatsTab
          ledgerId="ledger-1"
          bookId="book-2"
          ledger={ledgerFixture}
          ledgerToday="2026-08-24"
        />
      </QueryClientProvider>
    );
    await waitFor(() =>
      expect(
        vi.mocked(getEnhancedStats).mock.calls.some(([input]) => input.bookId === "book-2")
      ).toBe(true)
    );
  });

  it("drops the previous book's figures while the next book's query is pending", async () => {
    const { rerender, queryClient } = renderStatsTab("book-1");
    expect(await screen.findByText("¥40.00")).toBeInTheDocument();

    vi.mocked(getEnhancedStats).mockImplementation(() => new Promise<EnhancedStatsDto>(() => {}));
    rerender(
      <QueryClientProvider client={queryClient}>
        <StatsTab
          ledgerId="ledger-1"
          bookId="book-2"
          ledger={ledgerFixture}
          ledgerToday="2026-08-24"
        />
      </QueryClientProvider>
    );

    // The cached figures belong to the previous book and must not stand in for
    // book-2's.
    await waitFor(() =>
      expect(vi.mocked(getEnhancedStats).mock.calls.some(([input]) => input.bookId === "book-2"))
    );
    expect(screen.queryByText("¥40.00")).not.toBeInTheDocument();
    expect(screen.getByTestId("stats-visualization-skeleton")).toBeInTheDocument();
  });

  it("shows retry when the selected scope fails", async () => {
    vi.mocked(getEnhancedStats).mockRejectedValue(new Error("unavailable"));
    renderStatsTab();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });
});
