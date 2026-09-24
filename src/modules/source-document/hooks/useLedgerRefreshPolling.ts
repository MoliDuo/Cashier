"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getStreamRefreshAction } from "@/lib/queries/ledger-query-client";
import type { LedgerRefreshResult } from "@/modules/source-document/contract-refresh";
import { queryKeys } from "@/lib/query-keys";
import { applyStreamRefreshToCache } from "./stream-refresh-cache";

const REFRESH_INTERVAL_MS = 3_000;
const REFRESH_STALE_TIME_MS = 3_000;
const MAX_ERROR_INTERVAL_MS = 30_000;
const consecutiveFailures = new WeakMap<object, Map<string, number>>();

function failureMap(queryClient: object) {
  const existing = consecutiveFailures.get(queryClient);
  if (existing != null) return existing;
  const created = new Map<string, number>();
  consecutiveFailures.set(queryClient, created);
  return created;
}

export function useLedgerRefreshPolling(ledgerId: string, enabled = true) {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.sourceDocumentRefresh(ledgerId);

  return useQuery({
    queryKey,
    queryFn: async (): Promise<LedgerRefreshResult> => {
      try {
        const previous = queryClient.getQueryData<LedgerRefreshResult>(queryKey);
        const result = await getStreamRefreshAction(ledgerId, {
          afterVersion: previous?.version ?? "0",
        });
        await applyStreamRefreshToCache(queryClient, ledgerId, result);
        failureMap(queryClient).delete(ledgerId);
        return result;
      } catch (error) {
        const failures = failureMap(queryClient);
        failures.set(ledgerId, (failures.get(ledgerId) ?? 0) + 1);
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
          failureMap(queryClient).get(ledgerId) ?? 0
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
