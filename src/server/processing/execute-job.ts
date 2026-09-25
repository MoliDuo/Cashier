import "server-only";
import type { ProcessingFailureCode } from "@/modules/source-document/lifecycle";
import type { ProcessingJobContract } from "@/server/processing/types";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { classifyFailure, findAppErrorCode, retryDelayMs } from "@/lib/background/retry";
import { holdLease } from "@/lib/db/lease";
import {
  ProcessingCancelledError,
  ProcessingFailure,
} from "@/modules/source-document/domain/parse/contracts";
import { recordProcessingFailure } from "@/modules/source-document/server/revisions";
import { claimProcessingJob, renewProcessingJobLease, rescheduleProcessingJob } from "./jobs";
import { processRevision } from "./revision-processor";
import { BACKGROUND_MAX_ATTEMPTS } from "@/config/tuning";

function toFailureCode(error: unknown): ProcessingFailureCode {
  if (error instanceof ProcessingFailure) return error.code;
  switch (findAppErrorCode(error)) {
    case "ai_rate_limited":
    case "ai_provider_unavailable":
    case "ai_timeout":
    case "ai_configuration_invalid":
      return "ai_provider_unavailable";
    case "FILE_NOT_FOUND":
      return "storage_failure";
    default:
      return "processing_unavailable";
  }
}

/**
 * Claims one processing attempt, keeps its lease alive while it is parsed, and
 * records the outcome. A transient failure gives the attempt back to the queue
 * until it runs out of attempts. Returns false when another execution holds it.
 */
export async function executeProcessingJob(job: ProcessingJobContract): Promise<boolean> {
  const claim = await claimProcessingJob(job.revisionId);
  if (claim == null) return false;
  const lease = { revisionId: claim.job.revisionId, claimToken: claim.claimToken };
  const failure = {
    ledgerId: claim.ledgerId,
    sourceDocumentId: claim.job.sourceDocumentId,
    revisionId: claim.job.revisionId,
    failureKind: "processing_error" as const,
    lease,
  };
  const revisionSubject = logIdentifier("revision", claim.job.revisionId);
  if (claim.attempt > BACKGROUND_MAX_ATTEMPTS) {
    await recordProcessingFailure({
      ...failure,
      failureMessage: "Processing retry limit reached",
      failureCode: "request_bound_retry_exhausted",
    });
    return true;
  }

  const held = holdLease(
    async () => (await renewProcessingJobLease(lease.revisionId, lease.claimToken)) != null,
    (reason, error) => {
      logger.warn(
        { revisionSubject, reason, errorCode: findAppErrorCode(error) ?? "UNKNOWN" },
        "Processing lease was lost; aborting worker"
      );
    }
  );

  try {
    await processRevision({
      ledgerId: claim.ledgerId,
      sourceDocumentId: claim.job.sourceDocumentId,
      revisionId: claim.job.revisionId,
      signal: held.signal,
      lease,
    });
  } catch (error) {
    if (error instanceof ProcessingCancelledError || held.signal.aborted) return true;
    const classified = classifyFailure(error);
    if (classified.kind === "transient" && claim.attempt < BACKGROUND_MAX_ATTEMPTS) {
      const delayMs = retryDelayMs(claim.attempt, classified.retryAfterMs);
      logger.warn(
        { revisionSubject, errorCode: classified.code, attempt: claim.attempt, delayMs },
        "Processing failed transiently; retrying later"
      );
      await rescheduleProcessingJob(lease, delayMs);
      return true;
    }
    if (classified.kind === "configuration") {
      logger.error(
        { revisionSubject, errorCode: classified.code },
        "Processing failed on provider configuration"
      );
    }
    await recordProcessingFailure({
      ...failure,
      failureMessage: error instanceof Error ? error.message : "Processing failed",
      failureCode: toFailureCode(error),
    });
  } finally {
    held.stop();
  }

  return true;
}
