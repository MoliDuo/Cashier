import { after } from "next/server";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import {
  drainDueCategoryAssignments,
  recoverLedgerCategoryAssignments,
  runCategoryAssignmentJob,
} from "@/server/category-assignment/run";

/**
 * The only module in this feature that touches `after()`. Everything the
 * request has to persist is already committed by the time this is called — the
 * callback only advances the run, never registers it.
 *
 * This is server-only utility code rather than a "use server" action: it is
 * invoked from within other server contexts, not from the client.
 */
export function scheduleCategoryAssignmentAfter(jobId: string, ledgerId: string): void {
  after(() =>
    runCategoryAssignmentJob(jobId).catch((error: unknown) => {
      logger.error(
        {
          error,
          jobSubject: logIdentifier("processing-job", jobId),
          ledgerSubject: logIdentifier("ledger", ledgerId),
        },
        "after() category assignment failed"
      );
    })
  );
}

/**
 * Schedules a recovery pass for one ledger. Called from the status query the
 * client is already polling, so a run whose `after()` callback died (a
 * restarted process, a closed tab) is picked up on the next poll; the daily
 * cron drains whatever no poll picked up.
 */
export function scheduleCategoryAssignmentRecoveryAfter(
  ledgerId: string,
  requestId?: string
): void {
  after(() =>
    recoverLedgerCategoryAssignments(ledgerId).catch((error: unknown) => {
      logger.error(
        { error, ledgerSubject: logIdentifier("ledger", ledgerId), requestId },
        "after() category assignment recovery failed"
      );
    })
  );
}

/** Schedules a pass over every ledger's due category work; the daily cron's backstop. */
export function scheduleCategoryAssignmentDrainAfter(): void {
  after(() =>
    drainDueCategoryAssignments().catch((error: unknown) => {
      logger.error({ error }, "after() category assignment drain failed");
    })
  );
}
