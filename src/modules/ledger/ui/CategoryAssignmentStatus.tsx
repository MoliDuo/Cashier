"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, RefreshCw, Square, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { textRoleClassName } from "@/components/typography";
import { queryKeys } from "@/lib/query-keys";
import {
  cancelCategoryAssignmentAction,
  retryCategoryAssignmentFailuresAction,
  retryCategoryAssignmentLatestAction,
} from "@/modules/ledger/server-actions/reclassification";
import type { CategoryReclassificationJob } from "@/modules/ledger/contracts";
import { CategoryAssignmentResultDialog } from "./CategoryAssignmentResultDialog";
import { isCategoryAssignmentJobActive } from "./category-assignment-status-visibility";

interface CategoryAssignmentStatusProps {
  ledgerId: string;
  job: CategoryReclassificationJob | null;
  isReadError: boolean;
  onRefresh: () => Promise<unknown>;
  onDismiss?: () => void;
}

export function CategoryAssignmentStatus({
  ledgerId,
  job,
  isReadError,
  onRefresh,
  onDismiss,
}: CategoryAssignmentStatusProps) {
  const t = useTranslations("BatchActions");
  const tCommon = useTranslations("Common");
  const queryClient = useQueryClient();
  const [resultsOpen, setResultsOpen] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const retryKeyRef = useRef<{ jobId: string; requestKey: string } | null>(null);
  const retryLatestKeyRef = useRef<{ jobId: string; requestKey: string } | null>(null);
  const cancel = useMutation({
    mutationFn: (jobId: string) => cancelCategoryAssignmentAction(ledgerId, { jobId }),
    onSuccess: (saved) =>
      queryClient.setQueryData(queryKeys.categoryReclassification(ledgerId), saved),
  });
  const retryLatest = useMutation({
    mutationFn: (jobId: string) => {
      if (retryLatestKeyRef.current?.jobId !== jobId) {
        retryLatestKeyRef.current = { jobId, requestKey: crypto.randomUUID() };
      }
      return retryCategoryAssignmentLatestAction(ledgerId, retryLatestKeyRef.current);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.categoryReclassification(ledgerId), saved);
      retryLatestKeyRef.current = null;
      setResultsOpen(false);
    },
  });
  const retry = useMutation({
    mutationFn: (jobId: string) => {
      if (retryKeyRef.current?.jobId !== jobId) {
        retryKeyRef.current = { jobId, requestKey: crypto.randomUUID() };
      }
      return retryCategoryAssignmentFailuresAction(ledgerId, retryKeyRef.current);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.categoryReclassification(ledgerId), saved);
      retryKeyRef.current = null;
      setResultsOpen(false);
    },
  });
  useEffect(() => {
    if (job?.nextRetryAt == null || job.retryingDocumentCount === 0) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [job?.nextRetryAt, job?.retryingDocumentCount]);
  if (job == null && !isReadError) return null;
  const active = isCategoryAssignmentJobActive(job);
  // Closing a live run would take away the only progress readout, the only Stop
  // control, and the retry the status polling still has to make, so the band
  // becomes closable once the run has an outcome to report.
  const canDismiss = onDismiss != null && !active;
  const retrySeconds =
    job?.nextRetryAt == null
      ? 0
      : Math.max(0, Math.ceil((Date.parse(job.nextRetryAt) - clock) / 1000));
  const label = isReadError
    ? t("categoryJobReadFailed")
    : job == null
      ? t("categoryJobReadFailed")
      : job.status === "preparing"
        ? t("categorySelectionUploading", { received: job.receivedCount, total: job.total })
        : job.status === "pending"
          ? t("categoryJobPending")
          : job.status === "running"
            ? t("categoryJobProgress", {
                processed: job.processedCount,
                total: job.total,
                active: job.activeDocumentCount,
              })
            : job.status === "succeeded"
              ? t("categoryJobSucceeded", {
                  applied: job.appliedCount,
                  confirmed: job.confirmedCount,
                })
              : job.status === "partial"
                ? t("categoryJobPartial")
                : job.status === "cancelled"
                  ? t("categoryJobCancelled")
                  : t("categoryJobFailed");
  return (
    <>
      <div
        id="category-assignment-status"
        className="flex min-h-11 flex-wrap items-center gap-2 border-y border-border bg-surface2 px-3 py-2"
        role="status"
      >
        <p className={textRoleClassName("bodyMuted", "min-w-0 flex-1")}>{label}</p>
        {job?.evidenceIncomplete ? (
          <p className={textRoleClassName("meta", "basis-full text-warning")}>
            {t("categoryEvidenceIncomplete")}
          </p>
        ) : null}
        {job != null && job.retryingDocumentCount > 0 ? (
          <p className={textRoleClassName("meta", "basis-full")}>
            {t("categoryJobRetrying", {
              count: job.retryingDocumentCount,
              seconds: retrySeconds,
            })}
          </p>
        ) : null}
        {active ? (
          <p className={textRoleClassName("meta", "basis-full")}>{t("categoryStopDescription")}</p>
        ) : null}
        {isReadError ? (
          <Button size="sm" variant="outline" onClick={() => void onRefresh()}>
            <RefreshCw className="h-4 w-4" />
            {t("categoryRefreshStatus")}
          </Button>
        ) : null}
        {job != null ? (
          <Button size="sm" variant="outline" onClick={() => setResultsOpen(true)}>
            <Eye className="h-4 w-4" />
            {t("categoryViewResults")}
          </Button>
        ) : null}
        {active && job != null ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate(job.id)}
          >
            <Square className="h-4 w-4" />
            {t("categoryStop")}
          </Button>
        ) : null}
        {canDismiss ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-w-9 shrink-0 px-2"
            aria-label={tCommon("close")}
            title={t("categoryAssignmentClose")}
            onClick={onDismiss}
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      {job == null ? null : (
        <CategoryAssignmentResultDialog
          ledgerId={ledgerId}
          job={job}
          open={resultsOpen}
          onOpenChange={setResultsOpen}
          onRetryFailed={() => retry.mutate(job.id)}
          onRetryLatest={() => retryLatest.mutate(job.id)}
        />
      )}
    </>
  );
}
