import type { CategoryReclassificationJobDto } from "@/modules/ledger/contracts";
import type { CategoryReclassificationJobRecord } from "@/modules/ledger/application/ports";

/**
 * The stored run as the client sees it. V2 selection rows stay on the server;
 * the DTO exposes mutually exclusive final-outcome counters.
 */
export function toCategoryReclassificationJobDto(
  job: CategoryReclassificationJobRecord,
  metrics?: {
    activeDocumentCount: number;
    retryingDocumentCount: number;
    nextRetryAt: string | null;
    evidenceIncomplete: boolean;
  }
): CategoryReclassificationJobDto {
  const formatVersion = job.formatVersion ?? 1;
  const failedCount = job.failedCount ?? 0;
  const conflictCount = job.conflictCount ?? 0;
  const skippedCount = job.skippedCount ?? 0;
  const cancelledCount = job.cancelledCount ?? 0;
  const documentTotal = job.documentTotal ?? 0;
  const documentCompleted = job.documentCompleted ?? 0;
  const total = formatVersion === 2 ? (job.declaredEntryCount ?? 0) : job.ledgerEntryIds.length;
  return {
    id: job.id,
    formatVersion,
    mode: job.mode ?? { kind: "ai", candidateCategoryIds: job.candidateCategoryIds },
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
    activeDocumentCount: metrics?.activeDocumentCount ?? 0,
    retryingDocumentCount: metrics?.retryingDocumentCount ?? 0,
    nextRetryAt: metrics?.nextRetryAt ?? job.nextAttemptAt ?? null,
    candidateCategories: job.candidateSnapshot ?? [],
    receivedCount: job.receivedEntryCount ?? total,
    errorCode: job.lastError,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt ?? null,
    canRetryFailed: failedCount > 0 && ["partial", "failed"].includes(job.status),
    evidenceIncomplete: metrics?.evidenceIncomplete ?? false,
  };
}
