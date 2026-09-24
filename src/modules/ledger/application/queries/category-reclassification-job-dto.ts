import type { CategoryReclassificationJobDto } from "@/modules/ledger/contracts";
import type { CategoryReclassificationJobRecord } from "@/modules/ledger/application/ports";

/**
 * The stored run as the client sees it. V2 selection rows stay on the server;
 * the DTO exposes mutually exclusive final-outcome counters.
 */
export function toCategoryReclassificationJobDto(
  job: CategoryReclassificationJobRecord,
  metrics: {
    activeDocumentCount: number;
    retryingDocumentCount: number;
    nextRetryAt: string | null;
    evidenceIncomplete: boolean;
  }
): CategoryReclassificationJobDto {
  const failedCount = job.failedCount;
  const conflictCount = job.conflictCount;
  const skippedCount = job.skippedCount;
  const cancelledCount = job.cancelledCount;
  const documentTotal = job.documentTotal;
  const documentCompleted = job.documentCompleted;
  const total = job.declaredEntryCount;
  return {
    id: job.id,
    mode: job.mode,
    status: job.status,
    total,
    processedCount:
      job.appliedCount +
      job.confirmedCount +
      failedCount +
      conflictCount +
      skippedCount +
      cancelledCount,
    appliedCount: job.appliedCount,
    confirmedCount: job.confirmedCount,
    failedCount,
    conflictCount,
    skippedCount,
    cancelledCount,
    documentTotal,
    documentCompleted,
    activeDocumentCount: metrics.activeDocumentCount,
    retryingDocumentCount: metrics.retryingDocumentCount,
    nextRetryAt: metrics.nextRetryAt,
    candidateCategories: job.candidateSnapshot,
    receivedCount: job.receivedEntryCount,
    errorCode: job.lastError,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    canRetryFailed: failedCount > 0 && ["partial", "failed"].includes(job.status),
    evidenceIncomplete: metrics.evidenceIncomplete,
  };
}
