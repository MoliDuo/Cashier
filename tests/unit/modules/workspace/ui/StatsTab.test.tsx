import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBookTotals, getEnhancedStats } from "@/lib/queries/ledger-query-client";
import { StatsTab } from "@/modules/workspace/ui/StatsTab";
import { useBookRevealStore } from "@/lib/store/book-reveal";
import type { EnhancedStatsDto, BookTotalsDto } from "@/modules/stats/contracts";
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
  getBookTotals: vi.fn(),
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
    archivedAt: null,
  },
  {
    id: "book-2",
    ledgerId: "ledger-1",
    name: "Shared",
    timeZone: null,
    sortOrder: 2,
    isDefault: false,
    archivedAt: null,
  },
];

const bookTotals: BookTotalsDto = {
  currency: "CNY",
  total: "9999",
  books: [
    { bookId: "book-1", total: "1111" },
    { bookId: "book-2", total: "2222" },
  ],
};

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
    useBookRevealStore.setState({ open: false });
    vi.mocked(getBookTotals).mockResolvedValue(bookTotals);
    vi.mocked(getEnhancedStats).mockImplementation(async (input) => ({
      ...statsFixture,
      summary: {
        ...statsFixture.summary,
        total: input.bookId === "book-1" ? "40" : input.bookId === "book-2" ? "80" : "120",
      },
    }));
  });

  it("shows 总账 first in the totals row, then the books in strip order", async () => {
    renderStatsTab();

    await screen.findByText("¥1,111.00");

    const labels = screen
      .getAllByText(/^(总账|Mine|Shared)$/)
      .map((element) => element.textContent);
    expect(labels).toEqual(["总账", "Mine", "Shared"]);
  });

  it("reads the whole totals row in one grouped query instead of one per book", async () => {
    // The clock is pinned so the component's own "today" refresh cannot add a
    // second range behind the assertion. Only Date is faked, so timers and
    // waitFor keep running.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-24T12:00:00Z"));
    try {
      renderStatsTab();

      await screen.findByText("¥1,111.00");

      expect(getBookTotals).toHaveBeenCalledTimes(1);
      expect(vi.mocked(getBookTotals).mock.calls[0]![0]).toMatchObject({
        ledgerId: "ledger-1",
        queryRange: { from: expect.any(String), to: expect.any(String) },
      });
      // The chart's own read is the only enhanced-stats scope: the row no longer
      // fires one more per book on every period change.
      await waitFor(() => expect(getEnhancedStats).toHaveBeenCalled());
      const scopes = new Set(
        vi.mocked(getEnhancedStats).mock.calls.map(([input]) => input.bookId ?? null)
      );
      expect(scopes).toEqual(new Set([null]));
    } finally {
      vi.useRealTimers();
    }
  });

  it("charts the book the page picked", async () => {
    const { rerender, queryClient } = renderStatsTab();
    await screen.findByText("¥1,111.00");

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

  it("drops the previous book's figures while the next book's query is pending", async () => {
    const { rerender, queryClient } = renderStatsTab("book-1");
    // book-1's own headline total, distinct from the row's grouped figures.
    expect(await screen.findByText("¥40.00")).toBeInTheDocument();

    vi.mocked(getEnhancedStats).mockImplementation(() => new Promise<EnhancedStatsDto>(() => {}));
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

    // The row still shows the cached grouped totals, but the chart's own figures
    // belong to the previous book and must not stand in for book-2's.
    await waitFor(() =>
      expect(vi.mocked(getEnhancedStats).mock.calls.some(([input]) => input.bookId === "book-2"))
    );
    expect(screen.queryByText("¥40.00")).not.toBeInTheDocument();
    expect(screen.getByTestId("stats-visualization-skeleton")).toBeInTheDocument();
  });

  it("names the selected book and offers the switcher back", async () => {
    renderStatsTab("book-2");

    const chip = await screen.findByTestId("book-scope-chip");
    expect(chip).toHaveTextContent("仅看 Shared");
    expect(chip).toHaveAttribute("aria-expanded", "false");
    expect(chip).toHaveAccessibleName(/正在查看 Shared/);

    await act(async () => {
      fireEvent.click(chip);
    });
    expect(useBookRevealStore.getState().open).toBe(true);
  });

  it("gives 总账 a keyboard-focusable way into the strip", async () => {
    renderStatsTab();

    const trigger = screen.getByTestId("book-scope-trigger");
    expect(trigger).toHaveTextContent("分账");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    trigger.focus();
    expect(trigger).toHaveFocus();

    await act(async () => {
      fireEvent.click(trigger);
    });
    expect(useBookRevealStore.getState().open).toBe(true);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("shows retry when the selected scope fails", async () => {
    vi.mocked(getEnhancedStats).mockRejectedValue(new Error("unavailable"));
    renderStatsTab();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });
});
