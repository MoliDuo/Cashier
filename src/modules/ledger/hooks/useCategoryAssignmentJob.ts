"use client";
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCategoryReclassificationJobAction } from "@/lib/queries/ledger-query-client";
import { queryKeys } from "@/lib/query-keys";
import { invalidateLedgerQueries } from "@/lib/mutations/ledger-invalidation";
import type { CategoryReclassificationJob } from "@/modules/ledger/contracts";

const ACTIVE_STATUSES = new Set(["preparing", "pending", "running"]);

export function useCategoryAssignmentJob(ledgerId: string) {
  const queryClient = useQueryClient();
  const lastProcessedRef = useRef(-1);
  const lastRefreshRef = useRef(0);
  const query = useQuery<CategoryReclassificationJob | null>({
    queryKey: queryKeys.categoryReclassification(ledgerId),
    queryFn: () => getCategoryReclassificationJobAction(ledgerId),
    refetchInterval: (query) => {
      if (query.state.status === "error") {
        const attempt = Math.max(0, query.state.fetchFailureCount - 1);
        return [5_000, 10_000, 20_000, 30_000][Math.min(attempt, 3)]!;
      }
      const job = query.state.data;
      return job != null && ACTIVE_STATUSES.has(job.status) ? 3_000 : false;
    },
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
    retry: false,
  });
  const job = query.data ?? null;
  useEffect(() => {
    if (job == null || job.processedCount === lastProcessedRef.current) return;
    lastProcessedRef.current = job.processedCount;
    const terminal = !ACTIVE_STATUSES.has(job.status);
    const now = Date.now();
    if (!terminal && now - lastRefreshRef.current < 3_000) return;
    lastRefreshRef.current = now;
    void invalidateLedgerQueries(queryClient, ledgerId, ["documents", "categories", "stats"]);
  }, [job, ledgerId, queryClient]);
  return {
    job,
    isReadError: query.isError,
    refresh: query.refetch,
  };
}
