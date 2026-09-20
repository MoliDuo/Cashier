"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { DeferredFeatureMessages } from "@/i18n/DeferredFeatureMessages";
import type { CategoryReclassificationJob } from "@/modules/ledger/contracts";
import {
  useCategoryAssignmentJob,
  type CategoryAssignmentNotice,
} from "@/modules/ledger/hooks/useCategoryAssignmentJob";
import { CategoryAssignmentStatus } from "./CategoryAssignmentStatus";

export interface CategoryAssignmentContextValue {
  ledgerId: string;
  /** The ledger's most recent assignment run. */
  job: CategoryReclassificationJob | null;
  isActive: boolean;
  isReadError: boolean;
  refresh: () => Promise<unknown>;
  dismiss: () => void;
  registerSubmittedJob: (job: CategoryReclassificationJob) => void;
}

const CategoryAssignmentContext = createContext<CategoryAssignmentContextValue | null>(null);

/**
 * The ledger's assignment run, as the page that owns it sees it. Components
 * below the tabs read this instead of starting a poll of their own: one owner
 * means one poll, one history of what this page watched, and one completion
 * notice — no matter which tab happens to be mounted.
 */
export function useCategoryAssignment(): CategoryAssignmentContextValue {
  const value = useContext(CategoryAssignmentContext);
  if (value == null) {
    throw new Error("useCategoryAssignment must be used inside CategoryAssignmentProvider");
  }
  return value;
}

/**
 * Follows the ledger's assignment run above the tabs, so a run survives tab
 * changes, and renders its status band and its completion notice. Mount it with
 * `key={ledgerId}` so a ledger switch starts from a clean history.
 */
export function CategoryAssignmentProvider({
  ledgerId,
  children,
}: {
  ledgerId: string;
  children: ReactNode;
}) {
  const locale = useLocale();
  const assignment = useCategoryAssignmentJob(ledgerId);
  const { notices, consumeNotice } = assignment;
  // The band and the completion notice are the only readers of the details
  // messages, and only one of them may be waiting at a time.
  const hasSomethingToSay = assignment.isVisible || notices.length > 0;

  return (
    <CategoryAssignmentContext.Provider
      value={{
        ledgerId,
        job: assignment.job,
        isActive: assignment.isActive,
        isReadError: assignment.isReadError,
        refresh: assignment.refresh,
        dismiss: assignment.dismiss,
        registerSubmittedJob: assignment.registerSubmittedJob,
      }}
    >
      {hasSomethingToSay ? (
        <DeferredFeatureMessages feature="details" locale={locale} fallback={null}>
          {notices.map((notice) => (
            <CategoryAssignmentNoticeReporter
              key={notice.jobId}
              notice={notice}
              onConsumed={consumeNotice}
            />
          ))}
          {assignment.isVisible ? (
            <CategoryAssignmentStatus
              ledgerId={ledgerId}
              job={assignment.job}
              isReadError={assignment.isReadError}
              onRefresh={assignment.refresh}
              onDismiss={assignment.dismiss}
              onTaskRegistered={assignment.registerSubmittedJob}
            />
          ) : null}
        </DeferredFeatureMessages>
      ) : null}
      {children}
    </CategoryAssignmentContext.Provider>
  );
}

/**
 * Reports one finished run. It only renders once the messages it speaks in have
 * loaded, so a notice waits for its translation instead of being dropped, and it
 * is consumed on the first report so a re-render cannot say it twice.
 */
function CategoryAssignmentNoticeReporter({
  notice,
  onConsumed,
}: {
  notice: CategoryAssignmentNotice;
  onConsumed: (jobId: string) => void;
}) {
  const tBatch = useTranslations("BatchActions");
  const reportedRef = useRef(false);
  useEffect(() => {
    if (reportedRef.current) return;
    reportedRef.current = true;
    const { job } = notice;
    if (job.status === "succeeded") {
      toast.success(
        tBatch("aiCategoryDone", {
          applied: job.appliedCount,
          confirmed: job.confirmedCount,
          issues: job.failedCount + job.conflictCount + job.skippedCount,
        })
      );
    } else {
      toast.error(tBatch("aiCategoryFailed"));
    }
    onConsumed(notice.jobId);
  }, [notice, onConsumed, tBatch]);
  return null;
}
