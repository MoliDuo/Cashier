import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import { useActiveTabQueryState } from "@/modules/workspace/hooks/useActiveTabQueryState";

describe("active tab refresh", () => {
  it("refreshes active stats queries without tab reports and excludes other tabs", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const stats = vi.fn().mockResolvedValue("stats");
    const entries = vi.fn().mockResolvedValue("entries");
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => {
        useQuery({ queryKey: ["ledger", "enhanced-stats"], queryFn: stats });
        useQuery({ queryKey: ["ledger", "entries"], queryFn: entries });
        return useActiveTabQueryState({ activeTab: "stats" });
      },
      { wrapper }
    );
    await waitFor(() => expect(result.current.isRefreshing).toBe(false));
    await act(() => result.current.refreshActiveTab());
    expect(stats).toHaveBeenCalledTimes(2);
    expect(entries).toHaveBeenCalledTimes(1);
    stats.mockRejectedValueOnce(new Error("unavailable"));
    await act(async () => {
      await expect(result.current.refreshActiveTab()).rejects.toThrow("unavailable");
    });
    expect(queryClient.getQueryData(["ledger", "enhanced-stats"])).toBe("stats");
  });

  it("refreshes both book lists for 设置", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const ledger = vi.fn().mockResolvedValue("ledger");
    const categories = vi.fn().mockResolvedValue("categories");
    const liveBooks = vi.fn().mockResolvedValue("books");
    const archivedBooks = vi.fn().mockResolvedValue("books-with-archived");
    const stream = vi.fn().mockResolvedValue("stream");
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => {
        useQuery({ queryKey: ["ledger"], queryFn: ledger });
        useQuery({ queryKey: ["ledger", "categories"], queryFn: categories });
        useQuery({ queryKey: ["ledger", "books"], queryFn: liveBooks });
        useQuery({
          queryKey: ["ledger", "books", "including-archived"],
          queryFn: archivedBooks,
        });
        useQuery({
          queryKey: ["ledger", "source-documents", "stream"],
          queryFn: stream,
        });
        return useActiveTabQueryState({ activeTab: "settings" });
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
    expect(stream).toHaveBeenCalledTimes(1);
  });
});
