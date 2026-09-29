import { after } from "next/server";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import {
  recoverCategoryAssignments,
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
export function scheduleCategoryAssignmentAfter(jobId: string): void {
  after(() =>
    runCategoryAssignmentJob(jobId).catch((error: unknown) => {
      logger.error(
        { error, jobSubject: logIdentifier("processing-job", jobId) },
        "after() category assignment failed"
      );
    })
  );
}

/**
 * Schedules a recovery pass over due category work. Called from the status
 * query the client is already polling, so a run whose `after()` callback died
 * (a restarted process, a closed tab) is picked up on the next poll; the daily
 * cron drains whatever no poll picked up.
 */
export function scheduleCategoryAssignmentRecoveryAfter(requestId?: string): void {
  after(() =>
    recoverCategoryAssignments().catch((error: unknown) => {
      logger.error({ error, requestId }, "after() category assignment recovery failed");
    })
  );
}

/** Schedules a pass over all due category work; the daily cron's backstop. */
export function scheduleCategoryAssignmentDrainAfter(): void {
  after(() =>
    recoverCategoryAssignments().catch((error: unknown) => {
      logger.error({ error }, "after() category assignment drain failed");
    })
  );
}
