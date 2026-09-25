import "server-only";
import { sql } from "drizzle-orm";
import type {
  ProcessingClaimContract,
  ProcessingRecoveryConfig,
  RecoverableProcessingJobContract,
} from "@/server/processing/types";
import { db } from "@/lib/db";

// Renewed every 15 seconds while the worker runs, so the length only decides how
// soon an attempt whose function was killed can be claimed again.
const DEFAULT_LEASE_MS = 60 * 1000;

/** Overrides for the lease length and the clock; tests use them to walk expiry. */
export interface ProcessingJobClock {
  leaseMs?: number;
  now?: () => Date;
}

function toIso(value: Date | string): string {
  return typeof value === "string" ? new Date(value).toISOString() : value.toISOString();
}

/**
 * Leases one processing attempt. Only the document's current submission, still
 * processing and not held by an unexpired lease, is claimable; the claim counts
 * the run so an attempt that keeps dying is failed once it runs out.
 */
export async function claimProcessingJob(
  revisionId: string,
  clock: ProcessingJobClock = {}
): Promise<ProcessingClaimContract | null> {
  const now = clock.now?.() ?? new Date();
  const claimToken = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + (clock.leaseMs ?? DEFAULT_LEASE_MS));
  // The outbox check covers the deploy window only: a worker of the previous
  // release still holding the attempt through its outbox row keeps it.
  const claimed = await db.execute<{
    ledger_id: string;
    source_document_id: string;
    id: string;
    submitted_at: Date | string;
    attempt_count: number;
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
        AND (revision.claim_expires_at IS NULL OR revision.claim_expires_at <= ${now})
        AND NOT EXISTS (
          SELECT 1 FROM processing_outbox outbox
          WHERE outbox.ledger_id = revision.ledger_id
            AND outbox.revision_id = revision.id
            AND outbox.status = 'claimed'
            AND outbox.claim_expires_at > ${now}
        )
      FOR UPDATE OF revision SKIP LOCKED
    )
    UPDATE source_document_revisions revision
    SET claim_token = ${claimToken}, claim_expires_at = ${expiresAt},
        attempt_count = revision.attempt_count + 1
    FROM candidate WHERE revision.id = candidate.id
    RETURNING revision.ledger_id, revision.source_document_id, revision.id,
      revision.submitted_at, revision.attempt_count
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
    claimToken,
    attempt: Number(row.attempt_count),
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Picks the ledger's processing attempts whose run was missed and pushes each
 * one's next run out by the cooldown. Only attempt rows are locked, skipping
 * ones another pass holds, so concurrent passes pick disjoint sets without
 * serializing on the ledger.
 */
export async function recoverProcessingJobs(
  ledgerId: string,
  config: ProcessingRecoveryConfig,
  clock: ProcessingJobClock = {}
): Promise<readonly RecoverableProcessingJobContract[]> {
  const now = clock.now?.() ?? new Date();
  const nextAvailable = new Date(now.getTime() + config.cooldownSeconds * 1000);
  const scheduled = await db.execute<{
    sourceDocumentId: string;
    revisionId: string;
    requestedAt: Date | string;
    attemptCount: number;
    nextAvailableAt: Date | string;
  }>(sql`
    WITH candidate AS (
      SELECT revision.id
      FROM source_document_revisions revision
      JOIN source_documents document
        ON document.ledger_id = revision.ledger_id
       AND document.id = revision.source_document_id
       AND document.latest_submission_revision_id = revision.id
       AND document.deleted_at IS NULL
      WHERE revision.ledger_id = ${ledgerId}
        AND revision.processing_status = 'processing'
        AND revision.next_available_at <= ${now}
        AND (revision.claim_expires_at IS NULL OR revision.claim_expires_at <= ${now})
      ORDER BY revision.next_available_at, revision.submitted_at, revision.id
      FOR UPDATE OF revision SKIP LOCKED
      LIMIT ${config.maxBatch}
    )
    UPDATE source_document_revisions revision
    SET next_available_at = ${nextAvailable}
    FROM candidate
    WHERE revision.id = candidate.id
    RETURNING revision.source_document_id AS "sourceDocumentId",
      revision.id AS "revisionId",
      revision.submitted_at AS "requestedAt",
      revision.attempt_count AS "attemptCount",
      revision.next_available_at AS "nextAvailableAt"
  `);
  return scheduled.rows.map((row) => ({
    ...row,
    attemptCount: Number(row.attemptCount),
    requestedAt: toIso(row.requestedAt),
    nextAvailableAt: toIso(row.nextAvailableAt),
  }));
}

export async function renewProcessingJobLease(
  revisionId: string,
  claimToken: string,
  clock: ProcessingJobClock = {}
): Promise<string | null> {
  const expiresAt = new Date(
    (clock.now?.() ?? new Date()).getTime() + (clock.leaseMs ?? DEFAULT_LEASE_MS)
  );
  const renewed = await db.execute(sql`
    UPDATE source_document_revisions
    SET claim_expires_at = ${expiresAt}
    WHERE id = ${revisionId}
      AND claim_token = ${claimToken}
      AND processing_status = 'processing'
    RETURNING id
  `);
  return renewed.rows.length === 1 ? expiresAt.toISOString() : null;
}
