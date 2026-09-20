"use server";

import type { ProcessingJobContract } from "@/application/contracts";
import { serverComposition } from "@/application/server-composition-root";
import type {
  PartialBatchCommandResult,
  VersionedTarget,
} from "@/modules/source-document/contracts";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { versionedTargetsSchema } from "@/modules/source-document/contract-schemas";
import { retrySourceDocument } from "@/modules/source-document/application/use-cases/retry-source-document";
import { withSourceDocumentLedgerAccess } from "./access";
import { scheduleProcessingAfter } from "@/application/processing/schedule-processing";

const PROCESSING_UNAVAILABLE_CODES = new Set([
  "AI_JSON_REPAIR_FAILED",
  "AI_MODEL_CONFIG_REQUIRED",
  "CURRENCY_NOT_FOUND",
  "EXCHANGE_RATES_FETCH_FAILED",
  "EXCHANGE_RATES_UNAVAILABLE",
  "FILE_NOT_FOUND",
  "IMAGE_LOAD_FAILED",
  "LOCAL_STORAGE_DOWNLOAD_FAILED",
  "LOCAL_STORAGE_UPLOAD_FAILED",
  "OPENAI_API_KEY_MISSING",
  "OPENAI_INVALID_RESPONSE",
  "PROCESSING_UNAVAILABLE",
  "RATE_LIMIT",
  "REQUEST_ABORTED",
  "STORAGE_UNAVAILABLE",
  "TASK_RUNTIME_EDGE_UNSUPPORTED",
  "TASK_RUNTIME_NOT_INITIALIZED",
]);

function stableBatchFailureCode(error: unknown): string {
  if (error instanceof AppError && PROCESSING_UNAVAILABLE_CODES.has(error.code)) {
    return "PROCESSING_UNAVAILABLE";
  }
  return error instanceof AppError ? error.code : "INTERNAL";
}

function logBatchFailure(operation: "delete" | "retry", error: unknown, code: string): void {
  logger.error(
    {
      error,
      code,
      operation,
      correlationId: crypto.randomUUID(),
    },
    "Source document batch item failed"
  );
}

/** What one item of a versioned batch came back as, once it did not throw. */
type VersionedBatchOutcome =
  | { status: "succeeded"; version: number }
  | { status: "stale"; expectedVersion: number; currentVersion: number };

/**
 * Runs one batch item at a time, keeping the order it was given, and reports
 * each one as succeeded, stale, or failed under a stable code. Both batch
 * actions differ only in the item they run, so the classification, logging and
 * partial-success shape live here rather than twice over.
 */
async function runVersionedBatch(
  operation: "delete" | "retry",
  targets: VersionedTarget[],
  run: (target: VersionedTarget) => Promise<VersionedBatchOutcome>
): Promise<PartialBatchCommandResult> {
  const result: PartialBatchCommandResult = {
    succeeded: [],
    stale: [],
    failed: [],
  };
  for (const target of targets) {
    const id = target.sourceDocumentId;
    try {
      const outcome = await run(target);
      if (outcome.status === "succeeded") {
        result.succeeded.push({ id, sourceDocumentId: id, version: outcome.version });
      } else {
        result.stale.push({
          id,
          sourceDocumentId: id,
          expectedVersion: outcome.expectedVersion,
          currentVersion: outcome.currentVersion,
        });
      }
    } catch (error) {
      const code = stableBatchFailureCode(error);
      logBatchFailure(operation, error, code);
      result.failed.push({ id, code });
    }
  }
  return result;
}

export const batchDeleteSourceDocumentsAction = withSourceDocumentLedgerAccess(
  async ({ ledgerId }, inputTargets: VersionedTarget[]): Promise<PartialBatchCommandResult> =>
    runVersionedBatch("delete", versionedTargetsSchema.parse(inputTargets), async (target) => {
      const deleted = await serverComposition.sourceDocumentAggregate.deleteDocuments({
        ledgerId,
        target,
      });
      return deleted.ok
        ? { status: "succeeded", version: deleted.version }
        : {
            status: "stale",
            expectedVersion: deleted.expectedVersion,
            currentVersion: deleted.currentVersion,
          };
    })
);

export const batchRetrySourceDocumentsAction = withSourceDocumentLedgerAccess(
  async ({ ledgerId }, inputTargets: VersionedTarget[]): Promise<PartialBatchCommandResult> => {
    const intents: ProcessingJobContract[] = [];
    const result = await runVersionedBatch(
      "retry",
      versionedTargetsSchema.parse(inputTargets),
      async (target) => {
        const retried = await retrySourceDocument(
          {
            ledgerId,
            sourceDocumentId: target.sourceDocumentId,
            expectedVersion: target.expectedVersion,
          },
          {
            submissions: {
              submit: serverComposition.sourceDocumentAggregate.installRetry,
            },
            scheduleProcessing: (job) => intents.push(job),
          }
        );
        return retried.ok
          ? { status: "succeeded", version: retried.version }
          : {
              status: "stale",
              expectedVersion: retried.expectedVersion,
              currentVersion: retried.currentVersion,
            };
      }
    );
    // The scheduled intents run after every item has been classified, so a
    // retry that was never created is never scheduled.
    for (const job of intents) scheduleProcessingAfter(job);
    return result;
  }
);
