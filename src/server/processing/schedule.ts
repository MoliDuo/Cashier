import "server-only";
import { after } from "next/server";
import type { ProcessingJobContract } from "@/server/processing/types";
import { executeProcessingJob } from "./execute-job";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";

/**
 * Unified request-bound processing scheduler.
 *
 * Every `after()` that executes a processing job goes through this helper
 * so a failure at the request boundary is always logged with the full job
 * identity (sourceDocumentId, revisionId) plus the optional requestId. The
 * claim CAS on the attempt makes duplicate scheduling harmless: the second
 * execution simply finds the attempt already claimed or finished.
 *
 * This deliberately does not add cron jobs, workers, or external queues.
 */
export function scheduleProcessingAfter(job: ProcessingJobContract, requestId?: string): void {
  after(() =>
    executeProcessingJob(job).catch((error: unknown) => {
      logger.error(
        {
          error,
          sourceDocumentSubject: logIdentifier("source-document", job.sourceDocumentId),
          revisionSubject: logIdentifier("revision", job.revisionId),
          requestedAt: job.requestedAt,
          requestId,
        },
        "after() processing job failed"
      );
    })
  );
}
