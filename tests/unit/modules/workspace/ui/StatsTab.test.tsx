import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEnhancedStats } from "@/lib/queries/ledger-query-client";
import { StatsTab } from "@/modules/workspace/ui/StatsTab";
import type { EnhancedStatsDto } from "@/modules/stats/contracts";
import type { BookDto } from "@/modules/ledger/contracts";
import type { Ledger } from "@/modules/ledger/contracts";
import { getDefaultLedger } from "tests/helpers/default-ledger";

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

const statsFixture: EnhancedStatsDto = {
  unconvertedCount: 0,
  summary: {
    total: "120",
    currency: "CNY",
    trend: { percent: 100, amount: "60" },
    dailyAverage: "20",
    comparison: {
      mode: "same_period",
      from: "2026-07-01",
      to: "2026-07-06",
      previousTotal: "60",
      amountDelta: "60",
      percent: 100,
    },
  },
  categories: [],
  chart: [],
  heatmap: {
    days: [],
    stats: { minAmount: "0", maxAmount: "0", avgAmount: "0", p80Amount: "0" },
  },
};

const books: BookDto[] = [
  {
    id: "book-1",
    ledgerId: "ledger-1",
    name: "Mine",
    timeZone: null,
    sortOrder: 1,
    isDefault: true,
  },
  {
    id: "book-2",
    ledgerId: "ledger-1",
    name: "Shared",
    timeZone: null,
    sortOrder: 2,
    isDefault: false,
  },
];

function renderStatsTab(bookId?: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <StatsTab
        ledgerId="ledger-1"
        books={books}
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
  });

  it("shows per-book totals alongside the total, and charts the book the page picked", async () => {
    vi.mocked(getEnhancedStats).mockImplementation(async (input) => ({
      ...statsFixture,
      summary: {
        ...statsFixture.summary,
        total: input.bookId === "book-1" ? "40" : input.bookId === "book-2" ? "80" : "120",
      },
    }));
    const { rerender, queryClient } = renderStatsTab();
    expect(await screen.findByText("¥40.00")).toBeInTheDocument();
    expect(screen.getByText("¥80.00")).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={queryClient}>
        <StatsTab
          ledgerId="ledger-1"
          books={books}
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

  it("shows retry when the selected scope fails", async () => {
    vi.mocked(getEnhancedStats).mockRejectedValue(new Error("unavailable"));
    renderStatsTab();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });
});
