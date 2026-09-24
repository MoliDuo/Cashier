"use client";

import { useMemo, useRef, useEffect, useCallback } from "react";
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { listStreamPageAction } from "@/lib/queries/ledger-query-client";
import type { SourceDocumentListItemDto } from "@/modules/source-document/contracts";
import type { ListStreamPageInput } from "../application/queries/list-stream-page";
import { queryKeys } from "@/lib/query-keys";
import {
  buildUnifiedStreamGroups,
  type UnifiedStreamGroup,
} from "@/modules/source-document/stream-grouping";
import type {
  LedgerRefreshResult,
  StreamRefreshResult,
} from "@/modules/source-document/contract-refresh";
import { useLedgerRefreshPolling } from "./useLedgerRefreshPolling";

type StreamPage = Awaited<ReturnType<typeof listStreamPageAction>>;

export interface UseSourceDocumentStreamOptions {
  mainCurrency?: string;
  /** Enable refresh polling for this stream. */
  enableRefresh?: boolean;
  queryDescriptor: {
    queryKey: readonly unknown[];
    filterSignature: string;
    getPageInput: (pageParam?: string) => ListStreamPageInput;
  };
}

function flattenAndDeduplicate(
  pages: readonly { items: SourceDocumentListItemDto[] }[] | undefined
): SourceDocumentListItemDto[] {
  const seen = new Set<string>();
  const result: SourceDocumentListItemDto[] = [];
  for (const page of pages ?? []) {
    for (const doc of page.items) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      result.push(doc);
    }
  }
  return result;
}

function seedRefreshBaseline(
  queryClient: ReturnType<typeof useQueryClient>,
  ledgerId: string,
  page: { generation: string; hasTransitionalWork: boolean }
) {
  const queryKey = queryKeys.sourceDocumentRefresh(ledgerId);
  queryClient.setQueryData<LedgerRefreshResult>(queryKey, (current) => {
    // A page refreshes only its own projection, not every ledger cache.
    // Only the refresh consumer may advance an existing baseline.
    if (current != null) return current;
    return {
      version: page.generation,
      changed: false,
      hasTransitionalWork: page.hasTransitionalWork,
      invalidations: { categories: false, settings: false, stats: false },
    };
  });
}

export function useSourceDocumentStream(ledgerId: string, options: UseSourceDocumentStreamOptions) {
  const queryClient = useQueryClient();
  const { enableRefresh = true, queryDescriptor, mainCurrency } = options;
  const streamPageKey = queryDescriptor.queryKey;
  const filterSignature = queryDescriptor.filterSignature;

  const observedRestartFingerprintRef = useRef<string | null>(null);

  const streamQuery = useInfiniteQuery({
    queryKey: streamPageKey,
    queryFn: async ({ pageParam }) => {
      const pageInput = queryDescriptor.getPageInput(pageParam as string | undefined);
      let page = await listStreamPageAction(ledgerId, pageInput);
      if (pageParam == null && page.restartRequired) {
        page = await listStreamPageAction(ledgerId, pageInput);
        if (page.restartRequired) {
          throw new Error("Stream restart did not produce a valid first page");
        }
      }
      seedRefreshBaseline(queryClient, ledgerId, page);
      return page;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const { data, isLoading, isFetchingNextPage, fetchNextPage, hasNextPage } = streamQuery;
  // A new filter window starts fresh: generation/restart state from the
  // previous window must not trigger a background restart for the new key.
  useEffect(() => {
    observedRestartFingerprintRef.current = null;
  }, [filterSignature, ledgerId]);

  // Replace an invalid paginated window only after its fresh first page is
  // ready. Resetting the query first would briefly replace the loaded list
  // with its skeleton during background refreshes.
  useEffect(() => {
    const pages = data?.pages;
    if (!pages || pages.length === 0) return;

    const anyRestart = pages.some((p) => p.restartRequired);
    const firstGen = pages[0]?.generation;
    if (firstGen == null) return;

    const generationChanged =
      anyRestart || (pages.length > 1 && pages.some((p) => p.generation !== firstGen));
    if (!generationChanged) return;
    const fingerprint = pages
      .map((page) => `${page.generation}:${page.restartRequired ? "1" : "0"}`)
      .join("|");
    if (observedRestartFingerprintRef.current === fingerprint) return;
    observedRestartFingerprintRef.current = fingerprint;
    let cancelled = false;
    void (async () => {
      try {
        const firstPageInput = queryDescriptor.getPageInput(undefined);
        let page = await listStreamPageAction(ledgerId, firstPageInput);
        if (page.restartRequired) page = await listStreamPageAction(ledgerId, firstPageInput);
        if (page.restartRequired || cancelled) return;
        seedRefreshBaseline(queryClient, ledgerId, page);
        queryClient.setQueryData<InfiniteData<StreamPage, string | undefined>>(streamPageKey, {
          pages: [page],
          pageParams: [undefined],
        });
      } catch {
        // Keep the last rendered window. A later refresh can provide a new
        // fingerprint and retry without blanking the list.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data, ledgerId, queryClient, queryDescriptor, streamPageKey]);

  const firstPageAvailable = data?.pages[0] != null;
  const refreshQuery = useLedgerRefreshPolling(ledgerId, enableRefresh && firstPageAvailable);
  const refetchRefresh = refreshQuery.refetch;
  const refresh = useCallback(async (): Promise<{
    changed: boolean;
    result?: StreamRefreshResult;
  }> => {
    const refreshed = await refetchRefresh();
    return {
      changed: refreshed.data?.changed ?? false,
      ...(refreshed.data === undefined ? {} : { result: refreshed.data }),
    };
  }, [refetchRefresh]);

  const items = useMemo(() => flattenAndDeduplicate(data?.pages), [data]);

  // Build unified stream groups (preserving server order)
  const streamGroups: UnifiedStreamGroup[] = useMemo(() => {
    return buildUnifiedStreamGroups(items, mainCurrency);
  }, [items, mainCurrency]);

  return {
    streamGroups,
    isLoading,
    queryKey: streamPageKey,
    queryStatus: streamQuery.status,
    queryIsFetching: streamQuery.isFetching,
    queryHasData: streamQuery.data !== undefined,
    refetch: streamQuery.refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError: streamQuery.isFetchNextPageError,
    /** Call the bounded explicit refresh path. */
    refresh,
  };
}
