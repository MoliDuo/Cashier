import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ConflictError } from "@/lib/errors";
import { categoryReclassificationJobs } from "@/persistence";
import type {
  CategoryReclassificationJobPort,
  CategoryReclassificationJobRecord,
  ClaimedCategoryReclassificationJob,
} from "@/modules/ledger/application/ports";

/**
 * Every retry spends real model tokens, so this is far less patient than the
 * exchange-rate queue (which retries cheap idempotent work eight times).
 */
const MAX_ATTEMPTS = 3;
const DEFAULT_CLAIM_LIMIT = 5;
const DEFAULT_CLAIM_LEASE_MS = 120_000;

type JobRow = typeof categoryReclassificationJobs.$inferSelect;

/**
 * Drizzle wraps driver failures in a `DrizzleQueryError` whose `cause` is the
 * original Postgres error, so the SQLSTATE and constraint name are one level
 * down from what the caller catches.
 */
function violatesConstraint(error: unknown, constraint: string): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && candidate != null; depth += 1) {
    if (
      candidate instanceof Error &&
      "code" in candidate &&
      (candidate as { code?: unknown }).code === "23505" &&
      "constraint" in candidate &&
      (candidate as { constraint?: unknown }).constraint === constraint
    ) {
      return true;
    }
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return false;
}

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
    formatVersion: row.formatVersion,
    mode,
    candidateSnapshot: row.candidateSnapshot,
    declaredEntryCount: row.declaredEntryCount,
    receivedEntryCount: row.receivedEntryCount,
    ledgerEntryIds: row.ledgerEntryIds,
    candidateCategoryIds: row.candidateCategoryIds,
    cursor: row.cursor,
    appliedCount: row.appliedCount,
    confirmedCount: row.confirmedCount,
    failedCount: row.failedCount,
    conflictCount: row.conflictCount,
    skippedCount: row.skippedCount,
    cancelledCount: row.cancelledCount,
    documentTotal: row.documentTotal,
    documentCompleted: row.documentCompleted,
    attempts: row.attempts,
    lastError: row.lastError,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const postgresCategoryReclassificationJobAdapter: CategoryReclassificationJobPort = {
  async enqueue(input) {
    try {
      const rows = await db
        .insert(categoryReclassificationJobs)
        .values({
          ledgerId: input.ledgerId,
          ledgerEntryIds: [...input.ledgerEntryIds],
          candidateCategoryIds: [...input.candidateCategoryIds],
        })
        .returning();
      return mapJob(rows[0]!);
    } catch (error) {
      if (violatesConstraint(error, "uq_category_reclassification_jobs_active")) {
        throw new ConflictError("A category reclassification is already running for this ledger");
      }
      throw error;
    }
  },

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

  async claim(input) {
    const limit = input.limit ?? DEFAULT_CLAIM_LIMIT;
    const leaseMs = input.leaseMs ?? DEFAULT_CLAIM_LEASE_MS;
    const claimToken = crypto.randomUUID();
    const claimExpiresAt = new Date(input.now.getTime() + leaseMs);

    return db.transaction(async (tx) => {
      const result = await tx.execute<{
        id: string;
        ledger_id: string;
        status: "pending" | "running" | "succeeded" | "failed";
        ledger_entry_ids: string[];
        candidate_category_ids: string[];
        cursor: number;
        applied_count: number;
        confirmed_count: number;
        attempts: number;
        last_error: string | null;
        created_at: Date;
        updated_at: Date;
        claim_token: string;
      }>(sql`
        WITH candidates AS (
          SELECT id
          FROM ${categoryReclassificationJobs}
          WHERE ${categoryReclassificationJobs.nextAttemptAt} <= ${input.now}
            AND (
              ${categoryReclassificationJobs.status} = 'pending'
              OR (
                ${categoryReclassificationJobs.status} = 'running'
                AND ${categoryReclassificationJobs.claimExpiresAt} < ${input.now}
              )
            )
            ${input.jobId == null ? sql`` : sql`AND ${categoryReclassificationJobs.id} = ${input.jobId}`}
            ${input.ledgerId == null ? sql`` : sql`AND ${categoryReclassificationJobs.ledgerId} = ${input.ledgerId}`}
          ORDER BY ${categoryReclassificationJobs.nextAttemptAt}, ${categoryReclassificationJobs.createdAt}
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE ${categoryReclassificationJobs} AS jobs
        SET
          status = 'running',
          claim_token = ${claimToken},
          claim_expires_at = ${claimExpiresAt},
          updated_at = now()
        FROM candidates
        WHERE jobs.id = candidates.id
        RETURNING jobs.id, jobs.ledger_id, jobs.status, jobs.ledger_entry_ids,
          jobs.candidate_category_ids, jobs.cursor, jobs.applied_count,
          jobs.confirmed_count, jobs.attempts, jobs.last_error, jobs.created_at,
          jobs.updated_at, jobs.claim_token
      `);

      return result.rows.map((row) => ({
        id: row.id,
        ledgerId: row.ledger_id,
        status: row.status,
        formatVersion: 1,
        mode: { kind: "ai", candidateCategoryIds: row.candidate_category_ids },
        candidateSnapshot: [],
        declaredEntryCount: row.ledger_entry_ids.length,
        receivedEntryCount: row.ledger_entry_ids.length,
        ledgerEntryIds: row.ledger_entry_ids,
        candidateCategoryIds: row.candidate_category_ids,
        cursor: row.cursor,
        appliedCount: row.applied_count,
        confirmedCount: row.confirmed_count,
        failedCount: 0,
        conflictCount: 0,
        skippedCount: 0,
        cancelledCount: 0,
        documentTotal: 0,
        documentCompleted: 0,
        attempts: row.attempts,
        lastError: row.last_error,
        nextAttemptAt: null,
        completedAt: null,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
        claimToken: row.claim_token,
      })) satisfies ClaimedCategoryReclassificationJob[];
    });
  },

  async recordProgress(input) {
    const updated = await db
      .update(categoryReclassificationJobs)
      .set({
        cursor: input.cursor,
        appliedCount: input.appliedCount,
        confirmedCount: input.confirmedCount,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(categoryReclassificationJobs.id, input.jobId),
          eq(categoryReclassificationJobs.claimToken, input.claimToken)
        )
      )
      .returning({ id: categoryReclassificationJobs.id });
    // Losing the lease means someone else owns the run now; stop writing.
    return updated.length === 1;
  },

  async complete(input) {
    const updated = await db
      .update(categoryReclassificationJobs)
      .set({
        status: "succeeded",
        cursor: input.cursor,
        appliedCount: input.appliedCount,
        confirmedCount: input.confirmedCount,
        lastError: null,
        claimToken: null,
        claimExpiresAt: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(categoryReclassificationJobs.id, input.jobId),
          eq(categoryReclassificationJobs.claimToken, input.claimToken)
        )
      )
      .returning({ id: categoryReclassificationJobs.id });
    return updated.length === 1;
  },

  async fail(input) {
    const updated = await db
      .update(categoryReclassificationJobs)
      .set({
        attempts: sql`${categoryReclassificationJobs.attempts} + 1`,
        status: sql`CASE
          WHEN ${categoryReclassificationJobs.attempts} + 1 >= ${MAX_ATTEMPTS}
          THEN 'failed'::category_reclassification_status
          ELSE 'pending'::category_reclassification_status
        END`,
        nextAttemptAt: sql`(${input.now})::timestamptz + least(
          interval '5 minutes',
          interval '10 seconds' * power(2, ${categoryReclassificationJobs.attempts})
        )`,
        lastError: input.errorCode,
        claimToken: null,
        claimExpiresAt: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(categoryReclassificationJobs.id, input.jobId),
          eq(categoryReclassificationJobs.claimToken, input.claimToken)
        )
      )
      .returning({ status: categoryReclassificationJobs.status });

    if (updated.length !== 1) {
      // The claim was lost; the run is still tracked by whoever holds it.
      return "retry_scheduled";
    }
    return updated[0]!.status === "failed" ? "permanently_failed" : "retry_scheduled";
  },
};
