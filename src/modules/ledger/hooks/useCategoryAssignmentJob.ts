"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchCategoryReclassificationJob } from "@/modules/ledger/queries";
import { queryKeys } from "@/lib/query-keys";
import { invalidateLedgerQueries } from "@/lib/mutations/ledger-invalidation";
import type { CategoryReclassificationJob } from "@/modules/ledger/contracts";
import {
  isCategoryAssignmentJobActive,
  shouldShowCategoryAssignmentStatus,
} from "@/modules/ledger/ui/category-assignment-status-visibility";

/** An active run moves in steps of a minute or more, so this is how often the poll asks for it. */
const ACTIVE_POLL_INTERVAL_MS = 3_000;
/** The same pace is the most often the ledger's lists are recounted from one run. */
const PROGRESS_REFRESH_INTERVAL_MS = 3_000;
/** Backoff for the status read itself; the poll has to outlast a slow run. */
const ERROR_POLL_INTERVALS_MS = [5_000, 10_000, 20_000, 30_000];
/** What a finished or progressing run makes stale. */
const REFRESH_GROUPS = ["documents", "categories", "stats"] as const;

/** A run's outcome that still has to reach the reader. */
export interface CategoryAssignmentNotice {
  jobId: string;
  job: CategoryReclassificationJob;
}

export interface CategoryAssignmentJobState {
  /** The ledger's most recent run, or null when it has never had one. */
  job: CategoryReclassificationJob | null;
  isActive: boolean;
  isReadError: boolean;
  /** Whether the status band has something worth showing. */
  isVisible: boolean;
  refresh: () => Promise<unknown>;
  dismiss: () => void;
  /**
   * Adopts a run this page just started or restarted. Registering it here — and
   * not in the component that submitted it — is what keeps the completion
   * notice alive when the reader moves to another tab before it finishes, and
   * what reports a run whose first answer already says it is over.
   */
  registerSubmittedJob: (job: CategoryReclassificationJob) => void;
  /** Outcomes waiting for their toast; consumed once each, by the notifier. */
  notices: readonly CategoryAssignmentNotice[];
  consumeNotice: (jobId: string) => void;
}

/** Everything about a poll that a reader can see change. */
function jobSignature(job: CategoryReclassificationJob): string {
  return [
    job.status,
    job.processedCount,
    job.appliedCount,
    job.confirmedCount,
    job.failedCount,
    job.conflictCount,
    job.skippedCount,
  ].join(":");
}

/**
 * The ledger's most recent assignment run, plus whether its status band has
 * anything worth showing. The run is followed here — above the tabs — because it
 * outlives the tab that starts it, so the band keeps reporting while the user
 * moves around the ledger.
 */
export function useCategoryAssignmentJob(): CategoryAssignmentJobState {
  const queryClient = useQueryClient();
  // The last poll this hook acted on, so a repeat of the same answer is not
  // mistaken for progress and a run that stops where it stood is not missed.
  const lastChangeRef = useRef<{ jobId: string; signature: string } | null>(null);
  const lastRefreshAtRef = useRef(0);
  const trailingRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The run this page watched, keyed by job so a new run starts as news again.
  const [watched, setWatched] = useState<{ jobId: string; wasActive: boolean } | null>(null);
  // Runs this page started or restarted, and the runs it has already reported.
  // Both are state because the render that works out what is news reads them;
  // recording the report in the same render is also what keeps the pass React
  // runs to settle that update from queueing the same run twice.
  const [submittedJobIds, setSubmittedJobIds] = useState<readonly string[]>([]);
  const [reportedJobIds, setReportedJobIds] = useState<readonly string[]>([]);
  // `"none"` means "nothing dismissed yet"; `null` is a dismissal of a read
  // failure, which has no job to key on.
  const [dismissedJobId, setDismissedJobId] = useState<string | null | "none">("none");
  const [notices, setNotices] = useState<CategoryAssignmentNotice[]>([]);
  const query = useQuery<CategoryReclassificationJob | null>({
    queryKey: queryKeys.categoryReclassification(),
    queryFn: () => fetchCategoryReclassificationJob(),
    refetchInterval: (query) => {
      if (query.state.status === "error") {
        const attempt = Math.max(0, query.state.fetchFailureCount - 1);
        return ERROR_POLL_INTERVALS_MS[Math.min(attempt, ERROR_POLL_INTERVALS_MS.length - 1)]!;
      }
      const job = query.state.data;
      return isCategoryAssignmentJobActive(job ?? null) ? ACTIVE_POLL_INTERVAL_MS : false;
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
  // A finished run is news once: this page started it, or this page watched it
  // move. One that was already over when the page arrived happened for someone
  // else and is not reprinted here.
  if (
    job != null &&
    !isActive &&
    !reportedJobIds.includes(job.id) &&
    (submittedJobIds.includes(job.id) || wasWatched)
  ) {
    setReportedJobIds((current) => [...current, job.id]);
    // Stopping a run is the reader's own action; the band says it was cancelled,
    // so it is not reported back as a failure.
    if (job.status !== "cancelled") {
      setNotices((current) => [...current, { jobId: job.id, job }]);
    }
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
  const clearTrailingRefresh = useCallback(() => {
    if (trailingRefreshRef.current != null) {
      clearTimeout(trailingRefreshRef.current);
      trailingRefreshRef.current = null;
    }
  }, []);
  const refreshLedger = useCallback(() => {
    lastRefreshAtRef.current = Date.now();
    void invalidateLedgerQueries(queryClient, [...REFRESH_GROUPS]);
  }, [queryClient]);

  /**
   * A new run and a run that has stopped both make the ledger stale at once. A
   * run still moving is listened to at most once per interval, with the change
   * that lands inside the interval held for a trailing refresh.
   */
  useEffect(() => {
    if (job == null) return;
    const signature = jobSignature(job);
    const previous = lastChangeRef.current;
    const isNewJob = previous == null || previous.jobId !== job.id;
    if (!isNewJob && previous.signature === signature) return;
    lastChangeRef.current = { jobId: job.id, signature };
    if (isNewJob || !isActive) {
      clearTrailingRefresh();
      refreshLedger();
      return;
    }
    const wait = PROGRESS_REFRESH_INTERVAL_MS - (Date.now() - lastRefreshAtRef.current);
    if (wait <= 0) {
      refreshLedger();
      return;
    }
    clearTrailingRefresh();
    trailingRefreshRef.current = setTimeout(() => {
      trailingRefreshRef.current = null;
      refreshLedger();
    }, wait);
  }, [job, isActive, clearTrailingRefresh, refreshLedger]);

  useEffect(() => clearTrailingRefresh, [clearTrailingRefresh]);

  const dismiss = useCallback(() => setDismissedJobId(job?.id ?? null), [job?.id]);
  const registerSubmittedJob = useCallback(
    (submitted: CategoryReclassificationJob) => {
      setSubmittedJobIds((current) =>
        current.includes(submitted.id) ? current : [...current, submitted.id]
      );
      queryClient.setQueryData(queryKeys.categoryReclassification(), submitted);
    },
    [queryClient]
  );
  const consumeNotice = useCallback((jobId: string) => {
    setNotices((current) => current.filter((notice) => notice.jobId !== jobId));
  }, []);

  return {
    job,
    isActive,
    isReadError,
    isVisible,
    refresh: query.refetch,
    dismiss,
    registerSubmittedJob,
    notices,
    consumeNotice,
  };
}
