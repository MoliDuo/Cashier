"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getStreamRefreshAction } from "@/lib/queries/ledger-query-client";
import type { LedgerRefreshResult } from "@/modules/source-document/contract-refresh";
import { queryKeys } from "@/lib/query-keys";
import { applyStreamRefreshToCache } from "./stream-refresh-cache";

const REFRESH_INTERVAL_MS = 3_000;
const REFRESH_STALE_TIME_MS = 3_000;
const MAX_ERROR_INTERVAL_MS = 30_000;
const consecutiveFailures = new WeakMap<object, number>();

export function useLedgerRefreshPolling(enabled = true) {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.sourceDocumentRefresh();

  return useQuery({
    queryKey,
    queryFn: async (): Promise<LedgerRefreshResult> => {
      try {
        const previous = queryClient.getQueryData<LedgerRefreshResult>(queryKey);
        const result = await getStreamRefreshAction({
          afterVersion: previous?.version ?? "0",
        });
        await applyStreamRefreshToCache(queryClient, result);
        consecutiveFailures.delete(queryClient);
        return result;
      } catch (error) {
        consecutiveFailures.set(queryClient, (consecutiveFailures.get(queryClient) ?? 0) + 1);
        throw error;
      }
    },
    enabled,
    staleTime: REFRESH_STALE_TIME_MS,
    retry: false,
    refetchInterval: (query) => {
      if (query.state.status === "error") {
        const failureCount = Math.max(
          query.state.fetchFailureCount,
          consecutiveFailures.get(queryClient) ?? 0
        );
        return Math.min(
          REFRESH_INTERVAL_MS * 2 ** Math.max(failureCount - 1, 0),
          MAX_ERROR_INTERVAL_MS
        );
      }
      return query.state.data?.hasTransitionalWork === true ? REFRESH_INTERVAL_MS : false;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
}
