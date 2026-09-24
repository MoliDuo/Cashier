import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { categoryReclassificationJobs } from "@/persistence";
import type {
  CategoryReclassificationJobPort,
  CategoryReclassificationJobRecord,
} from "@/modules/ledger/application/ports";

type JobRow = typeof categoryReclassificationJobs.$inferSelect;

function mapJob(row: JobRow): CategoryReclassificationJobRecord {
  const mode =
    row.mode === "assign"
      ? { kind: "assign" as const, categoryId: row.directCategoryId! }
      : row.mode === "clear"
        ? { kind: "clear" as const }
        : { kind: "ai" as const, candidateCategoryIds: row.candidateCategoryIds };
  return {
    id: row.id,
    ledgerId: row.ledgerId,
    status: row.status,
    mode,
    candidateSnapshot: row.candidateSnapshot,
    declaredEntryCount: row.declaredEntryCount,
    receivedEntryCount: row.receivedEntryCount,
    appliedCount: row.appliedCount,
    confirmedCount: row.confirmedCount,
    failedCount: row.failedCount,
    conflictCount: row.conflictCount,
    skippedCount: row.skippedCount,
    cancelledCount: row.cancelledCount,
    documentTotal: row.documentTotal,
    documentCompleted: row.documentCompleted,
    lastError: row.lastError,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const postgresCategoryReclassificationJobAdapter: CategoryReclassificationJobPort = {
  async get(input) {
    const row = await db.query.categoryReclassificationJobs.findFirst({
      where: and(
        eq(categoryReclassificationJobs.ledgerId, input.ledgerId),
        eq(categoryReclassificationJobs.id, input.jobId)
      ),
    });
    return row == null ? null : mapJob(row);
  },

  async getLatest(input) {
    const row = await db.query.categoryReclassificationJobs.findFirst({
      where: eq(categoryReclassificationJobs.ledgerId, input.ledgerId),
      orderBy: [
        desc(categoryReclassificationJobs.createdAt),
        desc(categoryReclassificationJobs.id),
      ],
    });
    return row == null ? null : mapJob(row);
  },
};
