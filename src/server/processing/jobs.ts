import "server-only";
import { sql } from "drizzle-orm";
import type {
  ProcessingClaimContract,
  ProcessingLeaseContract,
  RecoverableProcessingJobContract,
} from "@/server/processing/types";
import { db } from "@/lib/db";
import { databaseClockPlus, leaseExpiry, leaseFree, leaseHeldBy } from "@/lib/db/lease";

const claimToken = sql`revision.claim_token`;
const claimExpiresAt = sql`revision.claim_expires_at`;

function toIso(value: Date | string): string {
  return typeof value === "string" ? new Date(value).toISOString() : value.toISOString();
}

/**
 * Leases one processing attempt. Only the document's current submission, still
 * processing, due, and not held by an unexpired lease, is claimable; the claim
 * counts the run so an attempt that keeps dying is failed once it runs out.
 */
export async function claimProcessingJob(
  revisionId: string
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
      SELECT revision.id FROM source_document_revisions revision
      JOIN source_documents document
        ON document.ledger_id = revision.ledger_id
       AND document.id = revision.source_document_id
       AND document.latest_submission_revision_id = revision.id
       AND document.deleted_at IS NULL
      WHERE revision.id = ${revisionId}
        AND revision.processing_status = 'processing'
        AND revision.next_available_at <= clock_timestamp()
        AND ${leaseFree(claimToken, claimExpiresAt)}
      FOR UPDATE OF revision SKIP LOCKED
    )
    UPDATE source_document_revisions revision
    SET claim_token = ${token}, claim_expires_at = ${leaseExpiry()},
        attempt_count = revision.attempt_count + 1
    FROM candidate WHERE revision.id = candidate.id
    RETURNING revision.ledger_id, revision.source_document_id, revision.id,
      revision.submitted_at, revision.attempt_count, revision.claim_expires_at
  `);
  const row = claimed.rows[0];
  if (row == null) return null;
  return {
    ledgerId: row.ledger_id,
    job: {
      sourceDocumentId: row.source_document_id,
      revisionId: row.id,
      requestedAt: toIso(row.submitted_at),
    },
    claimToken: token,
    attempt: Number(row.attempt_count),
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
    revisionId: string;
    requestedAt: Date | string;
    attemptCount: number;
    nextAvailableAt: Date | string;
  }>(sql`
    SELECT revision.source_document_id AS "sourceDocumentId",
      revision.id AS "revisionId",
      revision.submitted_at AS "requestedAt",
      revision.attempt_count AS "attemptCount",
      revision.next_available_at AS "nextAvailableAt"
    FROM source_document_revisions revision
    JOIN source_documents document
      ON document.ledger_id = revision.ledger_id
     AND document.id = revision.source_document_id
     AND document.latest_submission_revision_id = revision.id
     AND document.deleted_at IS NULL
    WHERE revision.ledger_id = ${ledgerId}
      AND revision.processing_status = 'processing'
      AND revision.next_available_at <= clock_timestamp()
      AND ${leaseFree(claimToken, claimExpiresAt)}
    ORDER BY revision.next_available_at, revision.submitted_at, revision.id
    LIMIT ${maxBatch}
  `);
  return due.rows.map((row) => ({
    ...row,
    attemptCount: Number(row.attemptCount),
    requestedAt: toIso(row.requestedAt),
    nextAvailableAt: toIso(row.nextAvailableAt),
  }));
}

/** Extends a held lease; null once it was lost, reclaimed or the attempt ended. */
export async function renewProcessingJobLease(
  revisionId: string,
  token: string
): Promise<string | null> {
  const renewed = await db.execute<{ claim_expires_at: Date | string }>(sql`
    UPDATE source_document_revisions revision
    SET claim_expires_at = ${leaseExpiry()}
    WHERE revision.id = ${revisionId}
      AND ${leaseHeldBy(claimToken, claimExpiresAt, token)}
      AND revision.processing_status = 'processing'
    RETURNING revision.claim_expires_at
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
    UPDATE source_document_revisions revision
    SET claim_token = NULL, claim_expires_at = NULL,
        next_available_at = ${databaseClockPlus(delayMs)}
    WHERE revision.id = ${lease.revisionId}
      AND ${leaseHeldBy(claimToken, claimExpiresAt, lease.claimToken)}
      AND revision.processing_status = 'processing'
    RETURNING revision.id
  `);
  return released.rows.length === 1;
}
