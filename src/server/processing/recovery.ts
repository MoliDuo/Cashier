import "server-only";
import { after } from "next/server";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { recoverProcessingJobs } from "./jobs";
import { scheduleProcessingAfter } from "./schedule";
import {
  PROCESSING_RECOVERY_COOLDOWN_SECONDS,
  PROCESSING_RECOVERY_MAX_ATTEMPTS,
  PROCESSING_RECOVERY_MAX_BATCH,
} from "@/config/tuning";

/**
 * Schedules recovery of bounded processing intents that were missed by
 * earlier after() execution. Called from authenticated request boundaries:
 * ledger bootstrap, attention/count/detail reads, new submission, and Retry.
 *
 * Does NOT await AI completion. Does NOT start a global drain loop.
 * Does NOT scan other ledgers.
 *
 * This is a server-only utility — not a "use server" action, because it is
 * invoked from within other server contexts, not directly from the client.
 */
async function scheduleProcessingRecovery(ledgerId: string): Promise<void> {
  const config = {
    maxBatch: PROCESSING_RECOVERY_MAX_BATCH,
    maxAttempts: PROCESSING_RECOVERY_MAX_ATTEMPTS,
    cooldownSeconds: PROCESSING_RECOVERY_COOLDOWN_SECONDS,
  };

  // Every returned job had its schedule attempt count advanced under the
  // ledger lock, so a concurrent request picks a disjoint set. A job that just
  // reached the attempt limit still runs once; exhaustion is decided on a
  // later request, after the cooldown.
  const recoverable = await recoverProcessingJobs(ledgerId, config);

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
