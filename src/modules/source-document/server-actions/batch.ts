"use server";

import { deleteSourceDocumentAtomically } from "../server/delete";
import type { PartialBatchCommandResult } from "@/modules/source-document/contracts";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { parseSourceDocumentTargetIds } from "@/modules/source-document/contract-schemas";
import { retrySourceDocument } from "../server/retry";
import { withSourceDocumentLedgerAccess } from "./access";

const PROCESSING_UNAVAILABLE_CODES = new Set([
  "AI_JSON_REPAIR_FAILED",
  "AI_MODEL_CONFIG_REQUIRED",
  "CURRENCY_NOT_FOUND",
  "EXCHANGE_RATES_FETCH_FAILED",
  "EXCHANGE_RATES_UNAVAILABLE",
  "FILE_NOT_FOUND",
  "IMAGE_LOAD_FAILED",
  "OPENAI_API_KEY_MISSING",
  "OPENAI_INVALID_RESPONSE",
  "PROCESSING_UNAVAILABLE",
  "RATE_LIMIT",
  "REQUEST_ABORTED",
  "STORAGE_UNAVAILABLE",
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

/**
 * Runs one batch item at a time, keeping the order it was given, and reports
 * each one as succeeded or failed under a stable code. Both batch actions
 * differ only in the item they run, so the classification, logging and
 * partial-success shape live here rather than twice over.
 */
async function runBatch(
  operation: "delete" | "retry",
  sourceDocumentIds: string[],
  run: (sourceDocumentId: string) => Promise<unknown>
): Promise<PartialBatchCommandResult> {
  const result: PartialBatchCommandResult = { succeeded: [], failed: [] };
  for (const id of sourceDocumentIds) {
    try {
      await run(id);
      result.succeeded.push({ id, sourceDocumentId: id });
    } catch (error) {
      const code = stableBatchFailureCode(error);
      logBatchFailure(operation, error, code);
      result.failed.push({ id, code });
    }
  }
  return result;
}

export const batchDeleteSourceDocumentsAction = withSourceDocumentLedgerAccess(
  async ({ ledgerId }, sourceDocumentIds: string[]): Promise<PartialBatchCommandResult> =>
    runBatch("delete", parseSourceDocumentTargetIds(sourceDocumentIds), (sourceDocumentId) =>
      deleteSourceDocumentAtomically({ ledgerId, sourceDocumentId })
    )
);

export const batchRetrySourceDocumentsAction = withSourceDocumentLedgerAccess(
  async ({ ledgerId }, sourceDocumentIds: string[]): Promise<PartialBatchCommandResult> =>
    runBatch("retry", parseSourceDocumentTargetIds(sourceDocumentIds), (sourceDocumentId) =>
      retrySourceDocument({ ledgerId, sourceDocumentId })
    )
);
