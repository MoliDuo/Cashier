import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { categoryReclassificationJobs } from "@/persistence";
import type {
  CategoryAssignmentJobStatus,
  CategoryAssignmentMode,
} from "@/modules/ledger/contracts";
import type { ReclassificationCandidate } from "@/modules/ledger/domain/reclassification-protocol";
import { rowMode } from "./assignments";

/** A job as stored, including the ids a run has to walk. */
export interface CategoryReclassificationJobRecord {
  id: string;
  ledgerId: string;
  status: CategoryAssignmentJobStatus;
  mode: CategoryAssignmentMode;
  candidateSnapshot: ReclassificationCandidate[];
  declaredEntryCount: number;
  receivedEntryCount: number;
  appliedCount: number;
  confirmedCount: number;
  failedCount: number;
  conflictCount: number;
  skippedCount: number;
  cancelledCount: number;
  documentTotal: number;
  documentCompleted: number;
  lastError: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type JobRow = typeof categoryReclassificationJobs.$inferSelect;

function mapJob(row: JobRow): CategoryReclassificationJobRecord {
  return {
    id: row.id,
    ledgerId: row.ledgerId,
    status: row.status,
    mode: rowMode(row),
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

export async function getCategoryReclassificationJob(input: {
  ledgerId: string;
  jobId: string;
}): Promise<CategoryReclassificationJobRecord | null> {
  const row = await db.query.categoryReclassificationJobs.findFirst({
    where: and(
      eq(categoryReclassificationJobs.ledgerId, input.ledgerId),
      eq(categoryReclassificationJobs.id, input.jobId)
    ),
  });
  return row == null ? null : mapJob(row);
}

export async function getLatestCategoryReclassificationJob(input: {
  ledgerId: string;
}): Promise<CategoryReclassificationJobRecord | null> {
  const row = await db.query.categoryReclassificationJobs.findFirst({
    where: eq(categoryReclassificationJobs.ledgerId, input.ledgerId),
    orderBy: [desc(categoryReclassificationJobs.createdAt), desc(categoryReclassificationJobs.id)],
  });
  return row == null ? null : mapJob(row);
}
