"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCategoryReclassificationJobAction } from "@/lib/queries/ledger-query-client";
import { queryKeys } from "@/lib/query-keys";
import { invalidateLedgerQueries } from "@/lib/mutations/ledger-invalidation";
import type { CategoryReclassificationJob } from "@/modules/ledger/contracts";
import {
  isCategoryAssignmentJobActive,
  shouldShowCategoryAssignmentStatus,
} from "@/modules/ledger/ui/category-assignment-status-visibility";

/**
 * The ledger's most recent assignment run, plus whether its status band has
 * anything worth showing. The run is followed here — above the tabs — because it
 * outlives the tab that starts it, so the band keeps reporting while the user
 * moves around the ledger.
 */
export function useCategoryAssignmentJob(ledgerId: string) {
  const queryClient = useQueryClient();
  const lastProcessedRef = useRef(-1);
  const lastRefreshRef = useRef(0);
  // The run this page watched, keyed by job so a new run starts as news again.
  const [watched, setWatched] = useState<{ jobId: string; wasActive: boolean } | null>(null);
  // `"none"` means "nothing dismissed yet"; `null` is a dismissal of a read
  // failure, which has no job to key on.
  const [dismissedJobId, setDismissedJobId] = useState<string | null | "none">("none");
  const query = useQuery<CategoryReclassificationJob | null>({
    queryKey: queryKeys.categoryReclassification(ledgerId),
    queryFn: () => getCategoryReclassificationJobAction(ledgerId),
    refetchInterval: (query) => {
      if (query.state.status === "error") {
        const attempt = Math.max(0, query.state.fetchFailureCount - 1);
        return [5_000, 10_000, 20_000, 30_000][Math.min(attempt, 3)]!;
      }
      const job = query.state.data;
      return isCategoryAssignmentJobActive(job ?? null) ? 3_000 : false;
    },
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
    retry: false,
  });
  const job = query.data ?? null;
  const isActive = isCategoryAssignmentJobActive(job);
  const isReadError = query.isError;
  // The run this page watched: a job is news only in the render that first sees
  // it while it is still moving. Adjusting the record here rather than in an
  // effect keeps the band in the same commit as the job it describes, so a run
  // that finishes between two polls never flickers.
  const wasWatched = job != null && watched?.jobId === job.id && watched.wasActive;
  if (job != null && watched?.jobId !== job.id) {
    setWatched({ jobId: job.id, wasActive: isActive });
  } else if (job != null && isActive && !wasWatched) {
    setWatched({ jobId: job.id, wasActive: true });
  }
  const dismissed = job == null ? false : dismissedJobId === job.id;
  const readFailureDismissed = job == null && dismissedJobId === null;
  const isVisible = shouldShowCategoryAssignmentStatus({
    job,
    isReadError,
    wasActive: wasWatched,
    dismissed,
    readFailureDismissed,
  });
  const dismiss = useCallback(() => setDismissedJobId(job?.id ?? null), [job?.id]);
  useEffect(() => {
    if (job == null || job.processedCount === lastProcessedRef.current) return;
    lastProcessedRef.current = job.processedCount;
    const terminal = !isCategoryAssignmentJobActive(job);
    const now = Date.now();
    if (!terminal && now - lastRefreshRef.current < 3_000) return;
    lastRefreshRef.current = now;
    void invalidateLedgerQueries(queryClient, ledgerId, ["documents", "categories", "stats"]);
  }, [job, ledgerId, queryClient]);
  return {
    job,
    isReadError,
    refresh: query.refetch,
    isVisible,
    dismiss,
  };
}
