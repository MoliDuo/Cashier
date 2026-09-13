import type { CategoryReclassificationJobDto } from "@/modules/ledger/contracts";
import type { CategoryReclassificationJobRecord } from "@/modules/ledger/application/ports";

/**
 * The stored run as the client sees it. The entry and category id arrays stay
 * on the server; `total` and `undecidedCount` are derived here so no caller
 * has to recompute them.
 */
export function toCategoryReclassificationJobDto(
  job: CategoryReclassificationJobRecord
): CategoryReclassificationJobDto {
  const total = job.ledgerEntryIds.length;
  return {
    id: job.id,
    status: job.status,
    total,
    cursor: job.cursor,
    appliedCount: job.appliedCount,
    confirmedCount: job.confirmedCount,
    undecidedCount: Math.max(0, total - job.appliedCount - job.confirmedCount),
    attempts: job.attempts,
    lastError: job.lastError,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}
