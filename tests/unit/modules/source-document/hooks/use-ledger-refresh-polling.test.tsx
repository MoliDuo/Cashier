import { act, renderHook } from "@testing-library/react";
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getStreamRefreshActionMock, applyStreamRefreshToCacheMock } = vi.hoisted(() => ({
  getStreamRefreshActionMock: vi.fn(),
  applyStreamRefreshToCacheMock: vi.fn(),
}));

vi.mock("@/lib/queries/ledger-query-client", () => ({
  getStreamRefreshAction: getStreamRefreshActionMock,
}));
vi.mock("@/modules/source-document/hooks/stream-refresh-cache", () => ({
  applyStreamRefreshToCache: applyStreamRefreshToCacheMock,
}));

import { useLedgerRefreshPolling } from "@/modules/source-document/hooks/useLedgerRefreshPolling";
import { queryKeys } from "@/lib/query-keys";

const unchanged = {
  version: "1",
  changed: false,
  hasTransitionalWork: false,
  invalidations: { categories: false, settings: false, stats: false },
};

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useLedgerRefreshPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    focusManager.setFocused(true);
    onlineManager.setOnline(true);
    getStreamRefreshActionMock.mockReset();
    applyStreamRefreshToCacheMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    focusManager.setFocused(true);
    onlineManager.setOnline(true);
    vi.useRealTimers();
  });

  it("polls every three seconds while transitional work remains", async () => {
    getStreamRefreshActionMock
      .mockResolvedValueOnce({ ...unchanged, version: "1", hasTransitionalWork: true })
      .mockResolvedValueOnce({ ...unchanged, version: "2" });
    const { wrapper } = setup();

    renderHook(() => useLedgerRefreshPolling("ledger-1"), { wrapper });
    await flush();
    expect(getStreamRefreshActionMock).toHaveBeenCalledWith("ledger-1", {
      afterVersion: "0",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999);
    });
    expect(getStreamRefreshActionMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getStreamRefreshActionMock).toHaveBeenLastCalledWith("ledger-1", {
      afterVersion: "1",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(getStreamRefreshActionMock).toHaveBeenCalledTimes(2);
  });

  it("uses a hydrated baseline without refreshing during the three-second stale window", async () => {
    getStreamRefreshActionMock.mockResolvedValue(unchanged);
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(queryKeys.sourceDocumentRefresh("ledger-1"), {
      ...unchanged,
      version: "7",
      hasTransitionalWork: true,
    });

    renderHook(() => useLedgerRefreshPolling("ledger-1"), { wrapper });
    await flush();
    expect(getStreamRefreshActionMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999);
    });
    expect(getStreamRefreshActionMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getStreamRefreshActionMock).toHaveBeenCalledWith("ledger-1", {
      afterVersion: "7",
    });
  });

  it("retries after three seconds when the initial refresh fails", async () => {
    getStreamRefreshActionMock
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce(unchanged);
    const { wrapper } = setup();

    const { result } = renderHook(() => useLedgerRefreshPolling("ledger-1"), { wrapper });
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.isError).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999);
    });
    expect(getStreamRefreshActionMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getStreamRefreshActionMock).toHaveBeenLastCalledWith("ledger-1", {
      afterVersion: "0",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(getStreamRefreshActionMock).toHaveBeenCalledTimes(2);
  });

  it("backs off consecutive failures to the thirty-second cap", async () => {
    getStreamRefreshActionMock.mockRejectedValue(new Error("temporary outage"));
    const { wrapper } = setup();

    renderHook(() => useLedgerRefreshPolling("ledger-1"), { wrapper });
    await flush();
    const intervals = [3_000, 6_000, 12_000, 24_000, 30_000, 30_000];
    for (const [index, interval] of intervals.entries()) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(interval - 1);
      });
      expect(getStreamRefreshActionMock).toHaveBeenCalledTimes(index + 1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(getStreamRefreshActionMock).toHaveBeenCalledTimes(index + 2);
    }
  });

  it("pauses in the background and refreshes on focus and reconnect", async () => {
    getStreamRefreshActionMock
      .mockResolvedValueOnce({ ...unchanged, hasTransitionalWork: true })
      .mockResolvedValue(unchanged);
    const { wrapper } = setup();

    renderHook(() => useLedgerRefreshPolling("ledger-1"), { wrapper });
    await flush();
    focusManager.setFocused(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(getStreamRefreshActionMock).toHaveBeenCalledTimes(1);

    focusManager.setFocused(true);
    await flush();
    expect(getStreamRefreshActionMock).toHaveBeenCalledTimes(2);

    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await flush();
    expect(getStreamRefreshActionMock).toHaveBeenCalledTimes(3);
  });

  it("shares one in-flight request for observers of the same ledger", async () => {
    let resolve!: (value: typeof unchanged) => void;
    getStreamRefreshActionMock.mockReturnValue(
      new Promise((next) => {
        resolve = next;
      })
    );
    const { wrapper } = setup();

    renderHook(() => useLedgerRefreshPolling("ledger-1"), { wrapper });
    renderHook(() => useLedgerRefreshPolling("ledger-1"), { wrapper });
    await flush();
    expect(getStreamRefreshActionMock).toHaveBeenCalledTimes(1);

    resolve(unchanged);
    await flush();
  });
});
