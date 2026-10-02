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
import { recordProcessingFailure } from "@/modules/source-document/server/extraction-attempts";
import { sendServerEvent } from "@/lib/telemetry/server";
import type { ServerEventMap } from "@/lib/telemetry/events";
import { claimProcessingJob, renewProcessingJobLease, rescheduleProcessingJob } from "./jobs";
import { processAttempt } from "./attempt-processor";
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

type ProcessingFinished = Pick<ServerEventMap["processing.finished"], "outcome" | "errorKind">;

/**
 * Telemetry for an attempt that reached its end: how it ended and how long the
 * submission took to get there, tied to the browser's `record.submit` by the
 * job's correlation id. Best effort and silent when telemetry is not configured.
 */
function reportFinished(
  job: ProcessingJobContract,
  runs: number,
  finished: ProcessingFinished
): Promise<void> {
  return sendServerEvent(
    "processing.finished",
    {
      outcome: finished.outcome,
      ms: Math.max(0, Date.now() - Date.parse(job.requestedAt) || 0),
      runs,
      ...(finished.errorKind == null ? {} : { errorKind: finished.errorKind }),
    },
    job.correlationId
  );
}

/**
 * Claims one processing attempt, keeps its lease alive while it is parsed, and
 * records the outcome. A transient failure gives the attempt back to the queue
 * until it runs out of attempts. Returns false when another execution holds it.
 */
export async function executeProcessingJob(job: ProcessingJobContract): Promise<boolean> {
  const claim = await claimProcessingJob(job.attemptId);
  if (claim == null) return false;
  const lease = { attemptId: claim.job.attemptId, claimToken: claim.claimToken };
  const failure = {
    sourceDocumentId: claim.job.sourceDocumentId,
    attemptId: claim.job.attemptId,
    failureKind: "processing_error" as const,
    lease,
  };
  const attemptSubject = logIdentifier("attempt", claim.job.attemptId);
  if (claim.runNumber > BACKGROUND_MAX_ATTEMPTS) {
    await recordProcessingFailure({
      ...failure,
      failureMessage: "Processing retry limit reached",
      failureCode: "request_bound_retry_exhausted",
    });
    await reportFinished(job, claim.runNumber, {
      outcome: "failed",
      errorKind: "request_bound_retry_exhausted",
    });
    return true;
  }

  const held = holdLease(
    async () => (await renewProcessingJobLease(lease.attemptId, lease.claimToken)) != null,
    (reason, error) => {
      logger.warn(
        { attemptSubject, reason, errorCode: findAppErrorCode(error) ?? "UNKNOWN" },
        "Processing lease was lost; aborting worker"
      );
    }
  );

  let finished: ProcessingFinished | null = null;
  try {
    const result = await processAttempt({
      sourceDocumentId: claim.job.sourceDocumentId,
      attemptId: claim.job.attemptId,
      signal: held.signal,
      lease,
    });
    finished =
      result.processingStatus === "completed"
        ? { outcome: "completed" }
        : { outcome: "failed", errorKind: "invalid_input" };
  } catch (error) {
    if (error instanceof ProcessingCancelledError || held.signal.aborted) {
      // A lost lease is not an ending: whoever holds the attempt now reports it.
      if (error instanceof ProcessingCancelledError && !held.signal.aborted) {
        finished = { outcome: "cancelled" };
      }
      return true;
    }
    const classified = classifyFailure(error);
    if (classified.kind === "transient" && claim.runNumber < BACKGROUND_MAX_ATTEMPTS) {
      const delayMs = retryDelayMs(claim.runNumber, classified.retryAfterMs);
      logger.warn(
        { attemptSubject, errorCode: classified.code, runNumber: claim.runNumber, delayMs },
        "Processing failed transiently; retrying later"
      );
      await rescheduleProcessingJob(lease, delayMs);
      return true;
    }
    if (classified.kind === "configuration") {
      logger.error(
        { attemptSubject, errorCode: classified.code },
        "Processing failed on provider configuration"
      );
    }
    await recordProcessingFailure({
      ...failure,
      failureMessage: error instanceof Error ? error.message : "Processing failed",
      failureCode: toFailureCode(error),
    });
    finished = { outcome: "failed", errorKind: toFailureCode(error) };
  } finally {
    held.stop();
    if (finished != null) await reportFinished(job, claim.runNumber, finished);
  }

  return true;
}
