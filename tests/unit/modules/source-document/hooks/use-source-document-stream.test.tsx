import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { queryKeys } from "@/lib/query-keys";
import { buildStreamQueryDescriptor } from "@/modules/workspace/ledger-tab-query-descriptors";
import type { UseSourceDocumentStreamOptions } from "@/modules/source-document/hooks/useSourceDocumentStream";

const listStreamPageActionMock = vi.hoisted(() => vi.fn());
const refreshRefetchMock = vi.hoisted(() => vi.fn().mockResolvedValue({ data: undefined }));
const useLedgerRefreshPollingMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/queries/ledger-query-client", () => ({
  listStreamPageAction: listStreamPageActionMock,
}));

vi.mock("@/modules/source-document/hooks/useLedgerRefreshPolling", () => ({
  useLedgerRefreshPolling: useLedgerRefreshPollingMock,
}));

function createWrapper(
  queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  })
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const { useSourceDocumentStream } =
  await import("@/modules/source-document/hooks/useSourceDocumentStream");

function useTestSourceDocumentStream(
  ledgerId: string,
  options: Omit<UseSourceDocumentStreamOptions, "queryDescriptor"> & {
    dateRange?: { start?: string; end?: string };
    minAmount?: string;
    maxAmount?: string;
    statuses?: Array<"processing" | "failed">;
    search?: string;
  } = {}
) {
  const { dateRange, minAmount, maxAmount, statuses, search, ...streamOptions } = options;
  return useSourceDocumentStream({
    ...streamOptions,
    queryDescriptor: buildStreamQueryDescriptor({
      startDate: dateRange?.start,
      endDate: dateRange?.end,
      minAmount,
      maxAmount,
      statuses,
      search,
    }),
  });
}

function makeItem(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Doc ${id}`,
    text: null,
    files: [],
    status: "completed",
    failureMessage: null,
    entryDate: "2026-07-01",
    metadata: {},
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    deletedAt: null,
    hasImages: false,
    supportedActions: [],
    errorCode: null,
    latestSubmissionRevisionId: null,
    ...overrides,
  } as const;
}

describe("useSourceDocumentStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLedgerRefreshPollingMock.mockReturnValue({ refetch: refreshRefetchMock });
    listStreamPageActionMock.mockImplementation((params: { cursor?: string; limit?: number }) => {
      if (params.cursor == null) {
        return Promise.resolve({
          items: [
            makeItem("doc-1", { entryDate: "2026-07-15" }),
            makeItem("doc-2", { entryDate: "2026-07-10" }),
          ],
          nextCursor: "next-page-cursor",
          generation: "1",
        });
      }
      return Promise.resolve({
        items: [makeItem("doc-3", { entryDate: "2026-07-05" })],
        nextCursor: null,
        generation: "1",
      });
    });
  });

  it("does not let a newer stream page consume pending shared invalidations", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const baseline = {
      version: "1",
      changed: true,
      hasTransitionalWork: true,
      invalidations: { categories: true, settings: true, stats: true },
    };
    client.setQueryData(queryKeys.sourceDocumentRefresh(), baseline);
    listStreamPageActionMock.mockResolvedValueOnce({
      items: [makeItem("new")],
      nextCursor: null,
      generation: "8",
      hasTransitionalWork: false,
    });
    const { result, unmount } = renderHook(() => useTestSourceDocumentStream("ledger-1"), {
      wrapper: createWrapper(client),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(client.getQueryData(queryKeys.sourceDocumentRefresh())).toEqual(baseline);
    unmount();
    client.clear();
  });

  it("enables the shared refresh scope by default", async () => {
    renderHook(() => useTestSourceDocumentStream("ledger-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(useLedgerRefreshPollingMock).toHaveBeenCalledWith(true);
    });
  });

  it("keeps refresh polling disabled until the first page is available", async () => {
    let resolvePage!: (value: {
      items: ReturnType<typeof makeItem>[];
      nextCursor: null;
      generation: string;
      hasTransitionalWork: boolean;
    }) => void;
    listStreamPageActionMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePage = resolve;
      })
    );

    renderHook(() => useTestSourceDocumentStream("ledger-1"), {
      wrapper: createWrapper(),
    });
    expect(useLedgerRefreshPollingMock).toHaveBeenLastCalledWith(false);

    resolvePage({
      items: [makeItem("doc-1")],
      nextCursor: null,
      generation: "4",
      hasTransitionalWork: true,
    });
    await waitFor(() => {
      expect(useLedgerRefreshPollingMock).toHaveBeenLastCalledWith(true);
    });
  });

  it("does not overwrite a newer refresh baseline with an older stream page", async () => {
    listStreamPageActionMock.mockResolvedValueOnce({
      items: [makeItem("doc-1")],
      nextCursor: null,
      generation: "8",
      hasTransitionalWork: true,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const refreshKey = queryKeys.sourceDocumentRefresh();
    queryClient.setQueryData(refreshKey, {
      version: "9",
      changed: false,
      hasTransitionalWork: false,
      invalidations: { categories: false, settings: false, stats: false },
    });

    const { result } = renderHook(() => useTestSourceDocumentStream("ledger-1"), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(queryClient.getQueryData(refreshKey)).toMatchObject({
      version: "9",
      hasTransitionalWork: false,
    });
  });

  it("starts polling when a newer page shows work an idle baseline never saw", async () => {
    // Another device uploaded while this one sat idle; a mutation here then
    // refetched the list, which now shows that upload still processing.
    listStreamPageActionMock.mockResolvedValueOnce({
      items: [makeItem("doc-1", { status: "processing" })],
      nextCursor: null,
      generation: "10",
      hasTransitionalWork: true,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const refreshKey = queryKeys.sourceDocumentRefresh();
    const invalidations = { categories: true, settings: false, stats: true };
    queryClient.setQueryData(refreshKey, {
      version: "9",
      changed: true,
      hasTransitionalWork: false,
      invalidations,
    });

    const { result } = renderHook(() => useTestSourceDocumentStream("ledger-1"), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // The version stays the refresh consumer's to advance.
    expect(queryClient.getQueryData(refreshKey)).toEqual({
      version: "9",
      changed: true,
      hasTransitionalWork: true,
      invalidations,
    });
  });

  it("fetches the first page on mount and returns stream groups", async () => {
    const { result } = renderHook(() => useTestSourceDocumentStream("ledger-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.streamGroups.length).toBeGreaterThan(0);
    expect(result.current.hasNextPage).toBe(true);
    expect(listStreamPageActionMock).toHaveBeenCalledWith({
      cursor: undefined,
      limit: 20,
    });
  });

  it("fetches next page using the prior nextCursor", async () => {
    const { result } = renderHook(() => useTestSourceDocumentStream("ledger-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Fetch next page
    result.current.fetchNextPage();

    await waitFor(() => {
      expect(listStreamPageActionMock).toHaveBeenCalledWith({
        cursor: "next-page-cursor",
        limit: 20,
      });
    });
  });

  it("flattens pages and deduplicates by ID preserving server order", async () => {
    // Return doc-1 on both pages to test dedup across pages
    listStreamPageActionMock
      .mockResolvedValueOnce({
        items: [
          makeItem("doc-1", { entryDate: "2026-07-15" }),
          makeItem("doc-2", { entryDate: "2026-07-10" }),
        ],
        nextCursor: "cursor-2",
        generation: "1",
      })
      .mockResolvedValueOnce({
        items: [
          makeItem("doc-1", { entryDate: "2026-07-05" }), // Duplicate from first page
          makeItem("doc-3", { entryDate: "2026-07-01" }),
        ],
        nextCursor: null,
        generation: "1",
      });

    const { result } = renderHook(() => useTestSourceDocumentStream("ledger-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    result.current.fetchNextPage();

    // Wait for second page to load
    await waitFor(() => {
      expect(result.current.isFetchingNextPage).toBe(false);
    });

    // doc-1 appears on both pages; first occurrence (page 1) wins,
    // leaving doc-1, doc-2, doc-3 in server order
    const allIds = result.current.streamGroups.flatMap((g) =>
      g.items.map((i) => i.sourceDocument.id)
    );
    expect(allIds).toEqual(["doc-1", "doc-2", "doc-3"]);
    expect(allIds.filter((id) => id === "doc-1")).toHaveLength(1);
  });

  it("reports hasNextPage false after last page", async () => {
    listStreamPageActionMock.mockResolvedValue({
      items: [makeItem("doc-1")],
      nextCursor: null,
      generation: "1",
    });

    const { result } = renderHook(() => useTestSourceDocumentStream("ledger-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hasNextPage).toBe(false);
  });

  it("passes date filter options to the server action", async () => {
    const startDate = "2026-07-01";
    const endDate = "2026-07-31";

    renderHook(
      () =>
        useTestSourceDocumentStream("ledger-1", {
          dateRange: { start: startDate, end: endDate },
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(listStreamPageActionMock).toHaveBeenCalledWith({
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        cursor: undefined,
        limit: 20,
      });
    });
  });

  it("passes amount filter options to the server action", async () => {
    renderHook(
      () =>
        useTestSourceDocumentStream("ledger-1", {
          minAmount: "10",
          maxAmount: "100",
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(listStreamPageActionMock).toHaveBeenCalledWith({
        minAmount: "10",
        maxAmount: "100",
        cursor: undefined,
        limit: 20,
      });
    });
  });

  it("passes status filter options to the server action", async () => {
    renderHook(
      () =>
        useTestSourceDocumentStream("ledger-1", {
          statuses: ["processing", "failed"],
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(listStreamPageActionMock).toHaveBeenCalledWith({
        statuses: ["failed", "processing"], // Hook normalizes (sorts) for stable cache keys
        cursor: undefined,
        limit: 20,
      });
    });
  });

  it("keeps the current list until a fresh first page replaces a mismatched generation", async () => {
    let resolveFreshPage!: (value: {
      items: ReturnType<typeof makeItem>[];
      nextCursor: null;
      generation: string;
      hasTransitionalWork: boolean;
    }) => void;
    listStreamPageActionMock
      .mockResolvedValueOnce({
        items: [
          makeItem("doc-1", { entryDate: "2026-07-15" }),
          makeItem("doc-2", { entryDate: "2026-07-10" }),
        ],
        nextCursor: "cursor-2",
        generation: "1",
      })
      .mockResolvedValueOnce({
        items: [],
        nextCursor: null,
        generation: "2",
        restartRequired: true,
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFreshPage = resolve;
        })
      );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    const { result } = renderHook(() => useTestSourceDocumentStream("ledger-1"), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await result.current.fetchNextPage();
    await waitFor(() => {
      expect(listStreamPageActionMock).toHaveBeenCalledTimes(3);
    });

    expect(
      result.current.streamGroups.flatMap((group) =>
        group.items.map((item) => item.sourceDocument.id)
      )
    ).toEqual(["doc-1", "doc-2"]);

    resolveFreshPage({
      items: [makeItem("doc-fresh")],
      nextCursor: null,
      generation: "3",
      hasTransitionalWork: false,
    });
    await waitFor(() => {
      expect(result.current.streamGroups[0]?.items[0]?.sourceDocument.id).toBe("doc-fresh");
    });
  });

  it("retains two freshly refetched pages in the same new generation", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const reset = vi.spyOn(queryClient, "resetQueries");
    const { result } = renderHook(() => useTestSourceDocumentStream("ledger-1"), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(() => result.current.fetchNextPage());
    listStreamPageActionMock.mockClear();
    listStreamPageActionMock.mockImplementation((params) =>
      Promise.resolve({
        items: [makeItem(params.cursor == null ? "doc-new-1" : "doc-new-2")],
        nextCursor: params.cursor == null ? "new-cursor" : null,
        generation: "2",
      })
    );
    await act(() => result.current.refetch());
    expect(listStreamPageActionMock).toHaveBeenCalledTimes(2);
    expect(reset).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData<{ pages: unknown[] }>(buildStreamQueryDescriptor({}).queryKey)?.pages
    ).toHaveLength(2);
  });

  it("retries an invalid first page once before exposing stream data", async () => {
    listStreamPageActionMock
      .mockResolvedValueOnce({
        items: [],
        nextCursor: null,
        generation: "1",
        restartRequired: true,
        hasTransitionalWork: false,
      })
      .mockResolvedValueOnce({
        items: [makeItem("doc-fresh")],
        nextCursor: null,
        generation: "2",
        hasTransitionalWork: true,
      });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const { result } = renderHook(() => useTestSourceDocumentStream("ledger-1"), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.queryStatus).toBe("success"));

    expect(listStreamPageActionMock).toHaveBeenCalledTimes(2);
    expect(result.current.streamGroups[0]?.items[0]?.sourceDocument.id).toBe("doc-fresh");
    expect(queryClient.getQueryData(queryKeys.sourceDocumentRefresh())).toMatchObject({
      version: "2",
      hasTransitionalWork: true,
    });
  });

  it("fails a first-page fetch that requests two consecutive restarts", async () => {
    listStreamPageActionMock.mockResolvedValue({
      items: [],
      nextCursor: null,
      generation: "1",
      restartRequired: true,
      hasTransitionalWork: false,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const { result } = renderHook(() => useTestSourceDocumentStream("ledger-1"), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.queryStatus).toBe("error"));

    expect(listStreamPageActionMock).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData(queryKeys.sourceDocumentRefresh())).toBeUndefined();
  });

  it("renders the filtered page projection directly from the server page", async () => {
    const entryLatte = {
      id: "entry-latte",
      categoryId: null,
      sourceDocumentId: "doc-1",
      amount: "20.00",
      currency: "USD",
      itemName: "Latte",
      description: null,
      convertedAmount: "20.00",
      exchangeRate: "1.000000",
      createdAt: "2026-07-01T10:00:00.000Z",
      updatedAt: "2026-07-01T10:00:00.000Z",
      deletedAt: null,
      category: null,
    };
    listStreamPageActionMock.mockResolvedValue({
      items: [
        makeItem("doc-1", {
          title: "Server page title",
          updatedAt: "2026-07-01T10:00:00.000Z",
          ledgerEntries: [entryLatte],
        }),
      ],
      nextCursor: null,
      generation: "1",
    });

    const { result } = renderHook(
      () => useTestSourceDocumentStream("ledger-1", { search: "latte" }),
      {
        wrapper: createWrapper(),
      }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const rendered = result.current.streamGroups[0]?.items[0];
    expect(rendered?.sourceDocument.title).toBe("Server page title");
    expect(rendered?.ledgerEntries.map((entry) => entry.id)).toEqual(["entry-latte"]);
  });
});
