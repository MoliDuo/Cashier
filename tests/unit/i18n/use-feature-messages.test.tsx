import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { preloadFeatureMessages, useFeatureMessages } from "@/i18n/use-feature-messages";

describe("useFeatureMessages", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces a failed request and retries the same shared cache", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 } as Response);

    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useFeatureMessages("en", "stats"), { wrapper });

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ StatsTab: { month: "Month" } }),
    } as Response);

    act(() => result.current.retry());

    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });
    expect(result.current.data).toEqual({ StatsTab: { month: "Month" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("leaves the retry free to reach the server after a failed response", async () => {
    // Regression: the request asked for `cache: "force-cache"`, which replays
    // whatever the HTTP cache holds whatever its status. One 404 or gateway
    // error was then pinned, and the retry button re-read that same failure
    // instead of the server. The versioned URL and the immutable response
    // header are what keep a good catalog off the network.
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) } as Response);

    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useFeatureMessages("en", "stats"), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("/api/i18n/en/stats?v="), {
      credentials: "same-origin",
    });
  });

  it("deduplicates a preload and a mounted consumer through QueryClient", async () => {
    let resolveResponse!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      })
    );
    const queryClient = new QueryClient();
    const preload = preloadFeatureMessages(queryClient, "en", "details");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useFeatureMessages("en", "details"), { wrapper });

    expect(fetch).toHaveBeenCalledTimes(1);
    resolveResponse({
      ok: true,
      json: async () => ({ DetailsTab: { title: "Details" } }),
    } as Response);

    await expect(preload).resolves.toEqual({ DetailsTab: { title: "Details" } });
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.data).toEqual({ DetailsTab: { title: "Details" } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses complete parent messages without starting a request", () => {
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const available = {
      Calendar: { today: "Today" },
      DateRangeFilter: { apply: "Apply" },
      StatsChart: { total: "Total" },
      StatsTab: { month: "Month" },
    };
    const { result } = renderHook(() => useFeatureMessages("en", "stats", available), {
      wrapper,
    });

    expect(result.current.status).toBe("success");
    expect(result.current.data).toEqual(available);
    expect(fetch).not.toHaveBeenCalled();
  });
});
