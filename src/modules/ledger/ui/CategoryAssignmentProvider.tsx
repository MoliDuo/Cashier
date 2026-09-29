"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import {
  useCategoryAssignmentJob,
  type CategoryAssignmentNotice,
} from "@/modules/ledger/hooks/useCategoryAssignmentJob";
import { CategoryAssignmentStatus } from "./CategoryAssignmentStatus";
import { CategoryAssignmentContext } from "./category-assignment-context";
import { batchActionsCopy } from "@/copy/workspace";

/**
 * Follows the ledger's assignment run above the tabs, so a run survives tab
 * changes, and renders its status band and its completion notice.
 */
export function CategoryAssignmentProvider({ children }: { children: ReactNode }) {
  const assignment = useCategoryAssignmentJob();
  const { notices, consumeNotice } = assignment;
  // The band and the completion notice are the only readers of the details
  // messages, and only one of them may be waiting at a time.
  const hasSomethingToSay = assignment.isVisible || notices.length > 0;
  // The workspace re-renders this on every change of its own, and the run loads
  // after the page arrives; a new value either time would reach every reader
  // below, and a page still streaming in from the server is thrown away and
  // rendered again on the client when its context changes before it hydrates.
  // So the value holds only what the readers use.
  const { isActive, registerSubmittedJob } = assignment;
  const value = useMemo(
    () => ({ isActive, registerSubmittedJob }),
    [isActive, registerSubmittedJob]
  );

  return (
    <CategoryAssignmentContext.Provider value={value}>
      {hasSomethingToSay ? (
        <>
          {notices.map((notice) => (
            <CategoryAssignmentNoticeReporter
              key={notice.jobId}
              notice={notice}
              onConsumed={consumeNotice}
            />
          ))}
          {assignment.isVisible ? (
            <CategoryAssignmentStatus
              job={assignment.job}
              isReadError={assignment.isReadError}
              onRefresh={assignment.refresh}
              onDismiss={assignment.dismiss}
              onTaskRegistered={assignment.registerSubmittedJob}
            />
          ) : null}
        </>
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
  const reportedRef = useRef(false);
  useEffect(() => {
    if (reportedRef.current) return;
    reportedRef.current = true;
    const { job } = notice;
    if (job.status === "succeeded") {
      toast.success(
        batchActionsCopy.aiCategoryDone({
          applied: job.appliedCount,
          confirmed: job.confirmedCount,
          issues: job.failedCount + job.conflictCount + job.skippedCount,
        })
      );
    } else {
      toast.error(batchActionsCopy.aiCategoryFailed);
    }
    onConsumed(notice.jobId);
  }, [notice, onConsumed]);
  return null;
}
