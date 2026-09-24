import "server-only";
import type { ProcessingFailureCode } from "@/modules/source-document/lifecycle";
import type { ProcessingJobContract } from "@/server/processing/types";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import {
  ProcessingCancelledError,
  ProcessingFailure,
} from "@/modules/source-document/application/parse-source-document/contracts";
import { recordProcessingFailure } from "@/modules/source-document/server/revisions";
import { claimProcessingJob, completeProcessingJob, renewProcessingJobLease } from "./jobs";
import { processRevision } from "./revision-processor";

function toFailureCode(error: unknown): ProcessingFailureCode {
  if (error instanceof ProcessingFailure) return error.code;
  if (error instanceof AppError) {
    switch (error.code) {
      case "RATE_LIMIT":
      case "AI_PROVIDER_RATE_LIMITED":
      case "AI_PROVIDER_UNAVAILABLE":
        return "ai_provider_unavailable";
      case "EXCHANGE_RATES_UNAVAILABLE":
      case "EXCHANGE_RATES_FETCH_FAILED":
      case "CURRENCY_NOT_FOUND":
        return "exchange_rate_failure";
      case "FILE_NOT_FOUND":
        return "storage_failure";
    }
  }
  return "processing_unavailable";
}

/**
 * Claims one outbox job, keeps its lease alive while the revision is parsed,
 * and records the outcome. Returns false when another execution holds it.
 */
export async function executeProcessingJob(job: ProcessingJobContract): Promise<boolean> {
  const claim = await claimProcessingJob(job.id);
  if (claim == null) return false;

  const controller = new AbortController();
  let stopped = false;
  let renewalTimer: ReturnType<typeof setTimeout> | null = null;

  const renewLease = async (): Promise<void> => {
    if (stopped || controller.signal.aborted) return;
    try {
      const renewedUntil = await renewProcessingJobLease(claim.job.id, claim.claimToken);
      if (renewedUntil == null) {
        logger.warn(
          { processingJobSubject: logIdentifier("processing-job", claim.job.id) },
          "Processing lease was lost or cancelled; aborting worker"
        );
        controller.abort();
        return;
      }
    } catch (error) {
      logger.warn(
        {
          processingJobSubject: logIdentifier("processing-job", claim.job.id),
          errorCode: error instanceof AppError ? error.code : "UNKNOWN",
        },
        "Processing lease renewal failed; aborting worker"
      );
      controller.abort();
      return;
    }
    if (!stopped && !controller.signal.aborted) {
      renewalTimer = setTimeout(() => void renewLease(), 15_000);
    }
  };
  renewalTimer = setTimeout(() => void renewLease(), 15_000);

  try {
    const result = await processRevision({
      ledgerId: claim.ledgerId,
      sourceDocumentId: claim.job.sourceDocumentId,
      revisionId: claim.job.revisionId,
      signal: controller.signal,
      lease: { jobId: claim.job.id, claimToken: claim.claimToken },
    });
    if (result.completion === "residual") {
      await completeProcessingJob({
        jobId: claim.job.id,
        claimToken: claim.claimToken,
        processingStatus: result.processingStatus,
      });
    }
  } catch (error) {
    if (error instanceof ProcessingCancelledError || controller.signal.aborted) return true;
    await recordProcessingFailure({
      ledgerId: claim.ledgerId,
      sourceDocumentId: claim.job.sourceDocumentId,
      revisionId: claim.job.revisionId,
      failureKind: "processing_error",
      failureMessage: error instanceof Error ? error.message : "Processing failed",
      failureCode: toFailureCode(error),
      lease: { jobId: claim.job.id, claimToken: claim.claimToken },
    });
  } finally {
    stopped = true;
    if (renewalTimer != null) clearTimeout(renewalTimer);
  }

  return true;
}
