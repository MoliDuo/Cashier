import "server-only";
import { after } from "next/server";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { recoverProcessingJobs } from "./jobs";
import { scheduleProcessingAfter } from "./schedule";
import { PROCESSING_RECOVERY_MAX_BATCH } from "@/config/tuning";

/**
 * Schedules one ledger's due processing attempts that no run holds, each with
 * its own `after()`. Called from authenticated request boundaries (ledger
 * bootstrap, attention/count/detail reads, new submission, Retry) and from the
 * daily cron for every ledger. Does not await AI completion.
 */
export async function scheduleProcessingRecovery(ledgerId: string): Promise<void> {
  // Attempts are counted when a run claims the job, which is also where an
  // exhausted job is failed; scheduling one twice only loses the second claim.
  const recoverable = await recoverProcessingJobs(ledgerId, PROCESSING_RECOVERY_MAX_BATCH);

  if (recoverable.length === 0) return;

  logger.debug(
    { ledgerSubject: logIdentifier("ledger", ledgerId), count: recoverable.length },
    "Scheduling processing recovery intents"
  );

  for (const job of recoverable) {
    scheduleProcessingAfter(job);
  }
}

/**
 * Schedules the recovery pass itself as a request-bound `after()` callback
 * with unified failure logging. Call from authenticated request boundaries.
 */
export function scheduleProcessingRecoveryAfter(ledgerId: string, requestId?: string): void {
  after(async () => {
    try {
      await scheduleProcessingRecovery(ledgerId);
    } catch (error) {
      logger.error(
        { error, ledgerSubject: logIdentifier("ledger", ledgerId), requestId },
        "after() processing recovery failed"
      );
    }
  });
}
