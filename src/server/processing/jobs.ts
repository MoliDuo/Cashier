import "server-only";
import { sql } from "drizzle-orm";
import type {
  ProcessingClaimContract,
  ProcessingLeaseContract,
  RecoverableProcessingJobContract,
} from "@/server/processing/types";
import { db } from "@/lib/db";
import { databaseClockPlus, leaseExpiry, leaseFree, leaseHeldBy } from "@/lib/db/lease";

const claimToken = sql`attempt.claim_token`;
const claimExpiresAt = sql`attempt.claim_expires_at`;

function toIso(value: Date | string): string {
  return typeof value === "string" ? new Date(value).toISOString() : value.toISOString();
}

/**
 * Leases one processing attempt. Only the document's current submission, still
 * processing, due, and not held by an unexpired lease, is claimable; the claim
 * counts the run so an attempt that keeps dying is failed once it runs out.
 */
export async function claimProcessingJob(
  attemptId: string
): Promise<ProcessingClaimContract | null> {
  const token = crypto.randomUUID();
  const claimed = await db.execute<{
    ledger_id: string;
    source_document_id: string;
    id: string;
    submitted_at: Date | string;
    attempt_count: number;
    claim_expires_at: Date | string;
  }>(sql`
    WITH candidate AS (
      SELECT attempt.id FROM extraction_attempts attempt
      JOIN source_documents document
        ON document.ledger_id = attempt.ledger_id
       AND document.id = attempt.source_document_id
       AND document.latest_attempt_id = attempt.id
      WHERE attempt.id = ${attemptId}
        AND attempt.status = 'processing'
        AND attempt.next_attempt_at <= clock_timestamp()
        AND ${leaseFree(claimToken, claimExpiresAt)}
      FOR UPDATE OF attempt SKIP LOCKED
    )
    UPDATE extraction_attempts attempt
    SET claim_token = ${token}, claim_expires_at = ${leaseExpiry()},
        attempt_count = attempt.attempt_count + 1
    FROM candidate WHERE attempt.id = candidate.id
    RETURNING attempt.ledger_id, attempt.source_document_id, attempt.id,
      attempt.submitted_at, attempt.attempt_count, attempt.claim_expires_at
  `);
  const row = claimed.rows[0];
  if (row == null) return null;
  return {
    ledgerId: row.ledger_id,
    job: {
      sourceDocumentId: row.source_document_id,
      attemptId: row.id,
      requestedAt: toIso(row.submitted_at),
    },
    claimToken: token,
    runNumber: Number(row.attempt_count),
    expiresAt: toIso(row.claim_expires_at),
  };
}

/**
 * The ledger's processing attempts that are due but that no run holds: their
 * `after()` was lost, their function was killed, or their retry came due.
 * Nothing is written; a duplicate schedule just finds the attempt claimed.
 */
export async function recoverProcessingJobs(
  ledgerId: string,
  maxBatch: number
): Promise<readonly RecoverableProcessingJobContract[]> {
  const due = await db.execute<{
    sourceDocumentId: string;
    attemptId: string;
    requestedAt: Date | string;
    attemptCount: number;
    nextAttemptAt: Date | string;
  }>(sql`
    SELECT attempt.source_document_id AS "sourceDocumentId",
      attempt.id AS "attemptId",
      attempt.submitted_at AS "requestedAt",
      attempt.attempt_count AS "attemptCount",
      attempt.next_attempt_at AS "nextAttemptAt"
    FROM extraction_attempts attempt
    JOIN source_documents document
      ON document.ledger_id = attempt.ledger_id
     AND document.id = attempt.source_document_id
     AND document.latest_attempt_id = attempt.id
    WHERE attempt.ledger_id = ${ledgerId}
      AND attempt.status = 'processing'
      AND attempt.next_attempt_at <= clock_timestamp()
      AND ${leaseFree(claimToken, claimExpiresAt)}
    ORDER BY attempt.next_attempt_at, attempt.submitted_at, attempt.id
    LIMIT ${maxBatch}
  `);
  return due.rows.map((row) => ({
    ...row,
    attemptCount: Number(row.attemptCount),
    requestedAt: toIso(row.requestedAt),
    nextAttemptAt: toIso(row.nextAttemptAt),
  }));
}

/** Extends a held lease; null once it was lost, reclaimed or the attempt ended. */
export async function renewProcessingJobLease(
  attemptId: string,
  token: string
): Promise<string | null> {
  const renewed = await db.execute<{ claim_expires_at: Date | string }>(sql`
    UPDATE extraction_attempts attempt
    SET claim_expires_at = ${leaseExpiry()}
    WHERE attempt.id = ${attemptId}
      AND ${leaseHeldBy(claimToken, claimExpiresAt, token)}
      AND attempt.status = 'processing'
    RETURNING attempt.claim_expires_at
  `);
  const row = renewed.rows[0];
  return row == null ? null : toIso(row.claim_expires_at);
}

/**
 * Gives a held attempt back to the queue after a transient failure, due again
 * once the delay has passed. False when the lease was already lost.
 */
export async function rescheduleProcessingJob(
  lease: ProcessingLeaseContract,
  delayMs: number
): Promise<boolean> {
  const released = await db.execute(sql`
    UPDATE extraction_attempts attempt
    SET claim_token = NULL, claim_expires_at = NULL,
        next_attempt_at = ${databaseClockPlus(delayMs)}
    WHERE attempt.id = ${lease.attemptId}
      AND ${leaseHeldBy(claimToken, claimExpiresAt, lease.claimToken)}
      AND attempt.status = 'processing'
    RETURNING attempt.id
  `);
  return released.rows.length === 1;
}
