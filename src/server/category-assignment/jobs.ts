import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  categoryAssignmentDocuments,
  categoryAssignmentEntries,
  categoryAssignmentJobs,
} from "@/persistence";
import type {
  CategoryAssignmentJobStatus,
  CategoryAssignmentMode,
} from "@/modules/ledger/contracts";
import type { CategoryAssignmentCandidate } from "@/modules/ledger/domain/category-assignment-protocol";
import { rowMode } from "./assignments";

/** A job with its progress, counted from its entry and document rows when read. */
export interface CategoryAssignmentJobRecord {
  id: string;
  ledgerId: string;
  status: CategoryAssignmentJobStatus;
  mode: CategoryAssignmentMode;
  candidateSnapshot: CategoryAssignmentCandidate[];
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
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface JobProgressRow extends Record<string, unknown> {
  id: string;
  ledger_id: string;
  status: CategoryAssignmentJobStatus;
  mode: "ai" | "assign" | "clear";
  assign_category_id: string | null;
  candidate_snapshot: CategoryAssignmentCandidate[];
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

function mapJob(row: JobProgressRow): CategoryAssignmentJobRecord {
  return {
    id: row.id,
    ledgerId: row.ledger_id,
    status: row.status,
    mode: rowMode({
      mode: row.mode,
      assignCategoryId: row.assign_category_id,
      candidateSnapshot: row.candidate_snapshot,
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
    completedAt: row.completed_at == null ? null : toIso(row.completed_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

async function readJob(ledgerId: string, jobId: string | null) {
  const result = await db.execute<JobProgressRow>(sql`
    SELECT job.id, job.ledger_id, job.status, job.mode, job.assign_category_id,
      job.candidate_snapshot,
      job.completed_at, job.created_at, job.updated_at,
      entries.*, documents.*,
      CASE
        WHEN job.claim_token IS NOT NULL AND job.claim_expires_at > clock_timestamp()
          AND documents.due > 0 THEN 1
        ELSE 0
      END::text AS active
    FROM ${categoryAssignmentJobs} AS job
    CROSS JOIN LATERAL (
      SELECT
        count(*)::text AS entry_count,
        count(*) FILTER (WHERE outcome = 'applied')::text AS applied,
        count(*) FILTER (WHERE outcome = 'confirmed')::text AS confirmed,
        count(*) FILTER (WHERE outcome = 'failed')::text AS failed,
        count(*) FILTER (WHERE outcome = 'conflict')::text AS conflict,
        count(*) FILTER (WHERE outcome = 'skipped')::text AS skipped,
        count(*) FILTER (WHERE outcome = 'cancelled')::text AS cancelled
      FROM ${categoryAssignmentEntries} AS entry
      WHERE entry.job_id = job.id AND entry.ledger_id = job.ledger_id
    ) AS entries
    CROSS JOIN LATERAL (
      SELECT
        count(*)::text AS document_total,
        count(*) FILTER (WHERE status <> 'pending')::text AS document_completed,
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
      FROM ${categoryAssignmentDocuments} AS work
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

export async function getCategoryAssignmentJob(input: {
  ledgerId: string;
  jobId: string;
}): Promise<CategoryAssignmentJobRecord | null> {
  return readJob(input.ledgerId, input.jobId);
}

export async function getLatestCategoryAssignmentJob(input: {
  ledgerId: string;
}): Promise<CategoryAssignmentJobRecord | null> {
  return readJob(input.ledgerId, null);
}
