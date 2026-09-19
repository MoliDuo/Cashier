import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import { useActiveTabQueryState } from "@/modules/workspace/hooks/useActiveTabQueryState";

describe("active tab refresh", () => {
  it("refreshes active stats queries without tab reports and excludes other tabs and ledgers", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const stats = vi.fn().mockResolvedValue("stats");
    const otherLedger = vi.fn().mockResolvedValue("other");
    const entries = vi.fn().mockResolvedValue("entries");
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => {
        useQuery({ queryKey: ["ledger", "ledger-1", "enhanced-stats"], queryFn: stats });
        useQuery({ queryKey: ["ledger", "ledger-2", "enhanced-stats"], queryFn: otherLedger });
        useQuery({ queryKey: ["ledger", "ledger-1", "entries"], queryFn: entries });
        return useActiveTabQueryState({ ledgerId: "ledger-1", activeTab: "stats" });
      },
      { wrapper }
    );
    await waitFor(() => expect(result.current.isRefreshing).toBe(false));
    await act(() => result.current.refreshActiveTab());
    expect(stats).toHaveBeenCalledTimes(2);
    expect(otherLedger).toHaveBeenCalledTimes(1);
    expect(entries).toHaveBeenCalledTimes(1);
    stats.mockRejectedValueOnce(new Error("unavailable"));
    await act(async () => {
      await expect(result.current.refreshActiveTab()).rejects.toThrow("unavailable");
    });
    expect(queryClient.getQueryData(["ledger", "ledger-1", "enhanced-stats"])).toBe("stats");
  });

  it("refreshes both book lists for 设置 and never another ledger's", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const ledger = vi.fn().mockResolvedValue("ledger");
    const categories = vi.fn().mockResolvedValue("categories");
    const liveBooks = vi.fn().mockResolvedValue("books");
    const archivedBooks = vi.fn().mockResolvedValue("books-with-archived");
    const otherLedgerBooks = vi.fn().mockResolvedValue("other-books");
    const stream = vi.fn().mockResolvedValue("stream");
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => {
        useQuery({ queryKey: ["ledger", "ledger-1"], queryFn: ledger });
        useQuery({ queryKey: ["ledger", "ledger-1", "categories"], queryFn: categories });
        useQuery({ queryKey: ["ledger", "ledger-1", "books"], queryFn: liveBooks });
        useQuery({
          queryKey: ["ledger", "ledger-1", "books", "including-archived"],
          queryFn: archivedBooks,
        });
        useQuery({ queryKey: ["ledger", "ledger-2", "books"], queryFn: otherLedgerBooks });
        useQuery({
          queryKey: ["ledger", "ledger-1", "source-documents", "stream"],
          queryFn: stream,
        });
        return useActiveTabQueryState({ ledgerId: "ledger-1", activeTab: "settings" });
      },
      { wrapper }
    );
    await waitFor(() => expect(result.current.isRefreshing).toBe(false));
    await act(() => result.current.refreshActiveTab());
    // 设置 shows the archived rows, so its refresh has to reach the list the
    // 分账 section reads as well as the switcher's live one.
    expect(archivedBooks).toHaveBeenCalledTimes(2);
    expect(liveBooks).toHaveBeenCalledTimes(2);
    expect(ledger).toHaveBeenCalledTimes(2);
    expect(categories).toHaveBeenCalledTimes(2);
    expect(otherLedgerBooks).toHaveBeenCalledTimes(1);
    expect(stream).toHaveBeenCalledTimes(1);
  });
});
