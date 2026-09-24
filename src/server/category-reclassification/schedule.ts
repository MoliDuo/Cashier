import { after } from "next/server";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import {
  recoverLedgerCategoryReclassifications,
  runCategoryReclassificationJob,
} from "@/server/category-reclassification/run";

/**
 * The only module in this feature that touches `after()`. Everything the
 * request has to persist is already committed by the time this is called — the
 * callback only advances the run, never registers it.
 *
 * This is server-only utility code rather than a "use server" action: it is
 * invoked from within other server contexts, not from the client.
 */
export function scheduleCategoryReclassificationAfter(jobId: string, ledgerId: string): void {
  after(() =>
    runCategoryReclassificationJob(jobId).catch((error: unknown) => {
      logger.error(
        {
          error,
          jobSubject: logIdentifier("processing-job", jobId),
          ledgerSubject: logIdentifier("ledger", ledgerId),
        },
        "after() category reclassification failed"
      );
    })
  );
}

/**
 * Schedules a recovery pass for one ledger. Called from the status query the
 * client is already polling, so a run whose `after()` callback died (a
 * restarted process, a closed tab) is picked up on the next poll; there is no
 * cron to find it otherwise.
 */
export function scheduleCategoryReclassificationRecoveryAfter(
  ledgerId: string,
  requestId?: string
): void {
  after(() =>
    recoverLedgerCategoryReclassifications(ledgerId).catch((error: unknown) => {
      logger.error(
        { error, ledgerSubject: logIdentifier("ledger", ledgerId), requestId },
        "after() category reclassification recovery failed"
      );
    })
  );
}
