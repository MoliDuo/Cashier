"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { textRoleClassName } from "@/components/typography";
import { getCategoryAssignmentResultsAction } from "@/lib/queries/ledger-query-client";
import { queryKeys } from "@/lib/query-keys";
import type { CategoryReclassificationJob } from "@/modules/ledger/contracts";

interface CategoryAssignmentResultDialogProps {
  ledgerId: string;
  job: CategoryReclassificationJob;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRetryFailed?: () => void;
  onRetryLatest?: () => void;
}

export function CategoryAssignmentResultDialog({
  ledgerId,
  job,
  open,
  onOpenChange,
  onRetryFailed,
  onRetryLatest,
}: CategoryAssignmentResultDialogProps) {
  const t = useTranslations("BatchActions");
  const common = useTranslations("Common");
  const outcomeLabel = (outcome: string | null) => {
    switch (outcome) {
      case "applied":
        return t("categoryOutcomeApplied");
      case "confirmed":
        return t("categoryOutcomeConfirmed");
      case "conflict":
        return t("categoryOutcomeConflict");
      case "skipped":
        return t("categoryOutcomeSkipped");
      case "cancelled":
        return t("categoryOutcomeCancelled");
      default:
        return t("categoryOutcomeFailed");
    }
  };
  const errorLabel = (errorCode: string) => {
    switch (errorCode) {
      case "ai_timeout":
        return t("categoryErrorAiTimeout");
      case "ai_rate_limited":
        return t("categoryErrorAiRateLimited");
      case "ai_provider_unavailable":
        return t("categoryErrorAiUnavailable");
      case "ai_configuration_invalid":
        return t("categoryErrorAiConfiguration");
      case "ai_schema_invalid":
        return t("categoryErrorAiSchema");
      case "storage_unavailable":
        return t("categoryErrorStorage");
      case "document_changed":
        return t("categoryErrorDocumentChanged");
      case "document_unavailable":
        return t("categoryErrorDocumentUnavailable");
      case "category_changed":
        return t("categoryErrorCategoryChanged");
      case "selection_upload_expired":
        return t("categoryErrorUploadExpired");
      case "upgrade_interrupted":
        return t("categoryErrorUpgradeInterrupted");
      default:
        return t("categoryErrorUnknown");
    }
  };
  const results = useInfiniteQuery({
    queryKey: queryKeys.categoryAssignmentResults(ledgerId, job.id),
    queryFn: ({ pageParam }) =>
      getCategoryAssignmentResultsAction(ledgerId, {
        jobId: job.id,
        ...(pageParam == null ? {} : { cursor: pageParam }),
        limit: 50,
      }),
    initialPageParam: null as number | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled: open,
  });
  const items = results.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        variant="detail"
        aria-describedby={undefined}
        className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[90dvh] sm:w-[calc(100vw-2rem)] sm:max-w-2xl sm:rounded-lg"
      >
        <DialogHeader className="shrink-0 border-b px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:py-4">
          <DialogTitle>{t("categoryResultsTitle")}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {job.evidenceIncomplete ? (
            <p className={textRoleClassName("bodyMuted", "mb-3 text-warning")} role="status">
              {t("categoryEvidenceIncomplete")}
            </p>
          ) : null}
          {results.isError ? (
            <div className="space-y-3" role="alert">
              <p className={textRoleClassName("bodyMuted")}>{t("categoryJobReadFailed")}</p>
              <Button variant="outline" onClick={() => void results.refetch()}>
                {common("refresh")}
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {items.map((item) => (
                <div key={item.ledgerEntryId} className="space-y-1 py-3">
                  <div className={textRoleClassName("bodyStrong")}>
                    {item.itemName ?? t("categoryEntryDeleted")}
                  </div>
                  <p className={textRoleClassName("meta")}>
                    {(item.originalCategoryName ?? t("uncategorized")) +
                      " -> " +
                      (item.targetCategoryName ?? t("uncategorized"))}
                  </p>
                  <p className={textRoleClassName("meta")}>
                    {outcomeLabel(item.outcome)}
                    {item.errorCode == null ? "" : `: ${errorLabel(item.errorCode)}`}
                  </p>
                </div>
              ))}
              {results.hasNextPage ? (
                <Button
                  className="mt-4 w-full"
                  variant="outline"
                  disabled={results.isFetchingNextPage}
                  onClick={() => void results.fetchNextPage()}
                >
                  {common("loadMore")}
                </Button>
              ) : null}
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0 gap-2 border-t px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:py-4">
          {job.canRetryFailed && onRetryFailed != null ? (
            <Button variant="outline" onClick={onRetryFailed}>
              {t("categoryRetryFailed")}
            </Button>
          ) : null}
          {job.conflictCount > 0 && onRetryLatest != null ? (
            <Button variant="outline" onClick={onRetryLatest}>
              {t("categoryRetryLatest")}
            </Button>
          ) : null}
          <Button onClick={() => onOpenChange(false)}>{common("close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
