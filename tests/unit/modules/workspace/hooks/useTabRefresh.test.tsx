import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTabRefresh } from "@/modules/workspace/hooks/useTabRefresh";

describe("useTabRefresh", () => {
  afterEach(() => vi.restoreAllMocks());

  it("scrolls to the top and reads every ledger query on screen again, one refresh at a time", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    let release: () => void = () => undefined;
    const ledgerRead = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("first")
      .mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve("again"))));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => {
        const ledger = useQuery({ queryKey: ["ledger", "stream"], queryFn: ledgerRead });
        return { ledger, tab: useTabRefresh() };
      },
      { wrapper }
    );
    await waitFor(() => expect(result.current.ledger.data).toBe("first"));

    act(() => result.current.tab.refresh());
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    expect(result.current.tab.refreshing).toBe(true);
    act(() => result.current.tab.refresh());
    expect(scrollTo).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => expect(result.current.tab.refreshing).toBe(false));
    expect(result.current.ledger.data).toBe("again");
    expect(ledgerRead).toHaveBeenCalledTimes(2);
  });
});
