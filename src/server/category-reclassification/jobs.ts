import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  categoryReclassificationJobDocuments,
  categoryReclassificationJobEntries,
  categoryReclassificationJobs,
} from "@/persistence";
import type {
  CategoryAssignmentJobStatus,
  CategoryAssignmentMode,
} from "@/modules/ledger/contracts";
import type { ReclassificationCandidate } from "@/modules/ledger/domain/reclassification-protocol";
import { rowMode } from "./assignments";

/** A job with its progress, counted from its entry and document rows when read. */
export interface CategoryReclassificationJobRecord {
  id: string;
  ledgerId: string;
  status: CategoryAssignmentJobStatus;
  mode: CategoryAssignmentMode;
  candidateSnapshot: ReclassificationCandidate[];
  entryCount: number;
  appliedCount: number;
  confirmedCount: number;
  failedCount: number;
  conflictCount: number;
  skippedCount: number;
  cancelledCount: number;
  documentTotal: number;
  documentCompleted: number;
  /** Documents a worker is on right now: one while a run holds the job. */
  activeDocumentCount: number;
  /** Documents waiting out a transient failure. */
  retryingDocumentCount: number;
  nextRetryAt: string | null;
  evidenceIncomplete: boolean;
  lastError: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface JobProgressRow extends Record<string, unknown> {
  id: string;
  ledger_id: string;
  status: CategoryAssignmentJobStatus;
  mode: "ai" | "assign" | "clear";
  direct_category_id: string | null;
  candidate_category_ids: string[];
  candidate_snapshot: ReclassificationCandidate[];
  last_error: string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  entry_count: string;
  applied: string;
  confirmed: string;
  failed: string;
  conflict: string;
  skipped: string;
  cancelled: string;
  document_total: string;
  document_completed: string;
  active: string;
  retrying: string;
  next_retry_at: Date | string | null;
  evidence_incomplete: boolean;
}

function toIso(value: Date | string): string {
  return new Date(value).toISOString();
}

function mapJob(row: JobProgressRow): CategoryReclassificationJobRecord {
  return {
    id: row.id,
    ledgerId: row.ledger_id,
    status: row.status,
    mode: rowMode({
      mode: row.mode,
      directCategoryId: row.direct_category_id,
      candidateCategoryIds: row.candidate_category_ids,
    }),
    candidateSnapshot: row.candidate_snapshot,
    entryCount: Number(row.entry_count),
    appliedCount: Number(row.applied),
    confirmedCount: Number(row.confirmed),
    failedCount: Number(row.failed),
    conflictCount: Number(row.conflict),
    skippedCount: Number(row.skipped),
    cancelledCount: Number(row.cancelled),
    documentTotal: Number(row.document_total),
    documentCompleted: Number(row.document_completed),
    activeDocumentCount: Number(row.active),
    retryingDocumentCount: Number(row.retrying),
    nextRetryAt: row.next_retry_at == null ? null : toIso(row.next_retry_at),
    evidenceIncomplete: row.evidence_incomplete === true,
    lastError: row.last_error,
    completedAt: row.completed_at == null ? null : toIso(row.completed_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

async function readJob(ledgerId: string, jobId: string | null) {
  const result = await db.execute<JobProgressRow>(sql`
    SELECT job.id, job.ledger_id, job.status, job.mode, job.direct_category_id,
      job.candidate_category_ids, job.candidate_snapshot, job.last_error,
      job.completed_at, job.created_at, job.updated_at,
      entries.*, documents.*,
      CASE
        WHEN job.claim_token IS NOT NULL AND job.claim_expires_at > clock_timestamp()
          AND documents.due > 0 THEN 1
        ELSE 0
      END::text AS active
    FROM ${categoryReclassificationJobs} AS job
    CROSS JOIN LATERAL (
      SELECT
        count(*)::text AS entry_count,
        count(*) FILTER (WHERE outcome = 'applied')::text AS applied,
        count(*) FILTER (WHERE outcome = 'confirmed')::text AS confirmed,
        count(*) FILTER (WHERE outcome = 'failed')::text AS failed,
        count(*) FILTER (WHERE outcome = 'conflict')::text AS conflict,
        count(*) FILTER (WHERE outcome = 'skipped')::text AS skipped,
        count(*) FILTER (WHERE outcome = 'cancelled')::text AS cancelled
      FROM ${categoryReclassificationJobEntries} AS entry
      WHERE entry.job_id = job.id AND entry.ledger_id = job.ledger_id
    ) AS entries
    CROSS JOIN LATERAL (
      SELECT
        count(*)::text AS document_total,
        count(*) FILTER (WHERE status NOT IN ('pending', 'running'))::text AS document_completed,
        count(*) FILTER (
          WHERE status = 'pending' AND next_attempt_at <= clock_timestamp()
        ) AS due,
        count(*) FILTER (
          WHERE status = 'pending' AND error_code IS NOT NULL
            AND next_attempt_at > clock_timestamp()
        )::text AS retrying,
        min(next_attempt_at) FILTER (
          WHERE status = 'pending' AND error_code IS NOT NULL
            AND next_attempt_at > clock_timestamp()
        ) AS next_retry_at,
        coalesce(bool_or(evidence_incomplete), false) AS evidence_incomplete
      FROM ${categoryReclassificationJobDocuments} AS work
      WHERE work.job_id = job.id AND work.ledger_id = job.ledger_id
    ) AS documents
    WHERE job.ledger_id = ${ledgerId}
      ${jobId == null ? sql`` : sql`AND job.id = ${jobId}`}
    ORDER BY job.created_at DESC, job.id DESC
    LIMIT 1
  `);
  const row = result.rows[0];
  return row == null ? null : mapJob(row);
}

export async function getCategoryReclassificationJob(input: {
  ledgerId: string;
  jobId: string;
}): Promise<CategoryReclassificationJobRecord | null> {
  return readJob(input.ledgerId, input.jobId);
}

export async function getLatestCategoryReclassificationJob(input: {
  ledgerId: string;
}): Promise<CategoryReclassificationJobRecord | null> {
  return readJob(input.ledgerId, null);
}
