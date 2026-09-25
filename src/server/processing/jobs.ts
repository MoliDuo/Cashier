import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type {
  ProcessingClaimContract,
  ProcessingJobContract,
  ProcessingRecoveryConfig,
  RecoverableProcessingJobContract,
} from "@/server/processing/types";
import { db } from "@/lib/db";
import { processingOutbox } from "@/persistence";

// Renewed every 15 seconds while the worker runs, so the length only decides how
// soon a job whose function was killed can be claimed again.
const DEFAULT_LEASE_MS = 60 * 1000;

/** Overrides for the lease length and the clock; tests use them to walk expiry. */
export interface ProcessingJobClock {
  leaseMs?: number;
  now?: () => Date;
}

function mapJob(row: typeof processingOutbox.$inferSelect): ProcessingJobContract {
  return {
    id: row.id,
    sourceDocumentId: row.sourceDocumentId,
    revisionId: row.revisionId,
    requestedAt: row.requestedAt.toISOString(),
  };
}

export async function claimProcessingJob(
  jobId: string,
  clock: ProcessingJobClock = {}
): Promise<ProcessingClaimContract | null> {
  const now = clock.now?.() ?? new Date();
  const claimToken = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + (clock.leaseMs ?? DEFAULT_LEASE_MS));
  return db.transaction(async (tx) => {
    // Only the document's current submission, still processing, is claimable.
    // A row whose revision already finished or was superseded is left for the
    // recovery pass to close instead of being parsed again.
    const claimed = await tx.execute<typeof processingOutbox.$inferSelect>(sql`
      WITH candidate AS (
        SELECT outbox.id FROM processing_outbox outbox
        JOIN source_documents document
          ON document.ledger_id = outbox.ledger_id
         AND document.id = outbox.source_document_id
         AND document.latest_submission_revision_id = outbox.revision_id
         AND document.deleted_at IS NULL
        JOIN source_document_revisions revision
          ON revision.ledger_id = outbox.ledger_id
         AND revision.id = outbox.revision_id
         AND revision.processing_status = 'processing'
        WHERE outbox.id = ${jobId}
          AND (
            outbox.status = 'pending'
            OR (outbox.status = 'claimed' AND outbox.claim_expires_at <= ${now})
          )
        FOR UPDATE OF outbox SKIP LOCKED
      )
      UPDATE processing_outbox outbox
      SET status = 'claimed', started_at = COALESCE(outbox.started_at, now()), claim_token = ${claimToken},
          claim_expires_at = ${expiresAt},
          schedule_attempt_count = outbox.schedule_attempt_count + 1
      FROM candidate WHERE outbox.id = candidate.id
      RETURNING outbox.*
    `);
    const raw = claimed.rows?.[0] as Record<string, unknown> | undefined;
    const row =
      raw == null
        ? undefined
        : ({
            ...raw,
            ledgerId: raw.ledger_id,
            sourceDocumentId: raw.source_document_id,
            revisionId: raw.revision_id,
            requestedAt: new Date(raw.requested_at as string | Date),
            scheduleAttemptCount: Number(raw.schedule_attempt_count),
          } as typeof processingOutbox.$inferSelect);
    if (row == null) return null;
    const job = mapJob(row);
    return {
      ledgerId: row.ledgerId,
      job,
      claimToken,
      attempt: row.scheduleAttemptCount,
      expiresAt: expiresAt.toISOString(),
    };
  });
}

export async function recoverProcessingJobs(
  ledgerId: string,
  config: ProcessingRecoveryConfig,
  clock: ProcessingJobClock = {}
): Promise<readonly RecoverableProcessingJobContract[]> {
  const now = clock.now?.() ?? new Date();
  const nextAvailable = new Date(now.getTime() + config.cooldownSeconds * 1000);

  // Every statement locks only outbox rows, skipping ones another pass holds,
  // so concurrent passes pick disjoint sets without serializing on the ledger.
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      WITH candidate AS (
        SELECT outbox.id, outbox.revision_id,
          CASE
            WHEN document.deleted_at IS NOT NULL
              OR document.latest_submission_revision_id IS DISTINCT FROM outbox.revision_id
              OR revision.processing_status = 'cancelled'
            THEN 'cancelled'
            WHEN revision.processing_status = 'failed' THEN 'failed'
            ELSE 'completed'
          END AS outbox_status
        FROM processing_outbox outbox
        JOIN source_documents document
          ON document.ledger_id = outbox.ledger_id
         AND document.id = outbox.source_document_id
        JOIN source_document_revisions revision
          ON revision.ledger_id = outbox.ledger_id
         AND revision.id = outbox.revision_id
        WHERE outbox.ledger_id = ${ledgerId}
          AND outbox.status IN ('pending', 'claimed')
          AND (
            document.deleted_at IS NOT NULL
            OR document.latest_submission_revision_id IS DISTINCT FROM outbox.revision_id
            OR revision.processing_status <> 'processing'
          )
        ORDER BY outbox.created_at, outbox.id
        FOR UPDATE OF outbox SKIP LOCKED
        LIMIT ${config.maxBatch}
      ), closed AS (
        UPDATE processing_outbox outbox
        SET status = candidate.outbox_status::processing_outbox_status,
            completed_at = ${now}, claim_token = NULL, claim_expires_at = NULL
        FROM candidate
        WHERE outbox.id = candidate.id
          AND outbox.status IN ('pending', 'claimed')
        RETURNING candidate.revision_id
      )
      SELECT count(*) FROM closed
    `);

    const scheduled = await tx.execute<{
      id: string;
      sourceDocumentId: string;
      revisionId: string;
      requestedAt: Date | string;
      scheduleAttemptCount: number;
      nextAvailableAt: Date | string;
    }>(sql`
      WITH candidate AS (
        SELECT outbox.id
        FROM processing_outbox outbox
        JOIN source_documents document
          ON document.ledger_id = outbox.ledger_id
         AND document.id = outbox.source_document_id
         AND document.latest_submission_revision_id = outbox.revision_id
         AND document.deleted_at IS NULL
        JOIN source_document_revisions revision
          ON revision.ledger_id = outbox.ledger_id
         AND revision.id = outbox.revision_id
         AND revision.processing_status = 'processing'
        WHERE outbox.ledger_id = ${ledgerId}
          AND outbox.next_available_at <= ${now}
          AND (
            outbox.status = 'pending'
            OR (outbox.status = 'claimed' AND outbox.claim_expires_at <= ${now})
          )
        ORDER BY outbox.next_available_at, outbox.created_at, outbox.id
        FOR UPDATE OF outbox SKIP LOCKED
        LIMIT ${config.maxBatch}
      )
      UPDATE processing_outbox outbox
      SET next_available_at = ${nextAvailable}
      FROM candidate
      WHERE outbox.id = candidate.id
      RETURNING outbox.id,
        outbox.source_document_id AS "sourceDocumentId",
        outbox.revision_id AS "revisionId",
        outbox.requested_at AS "requestedAt",
        outbox.schedule_attempt_count AS "scheduleAttemptCount",
        outbox.next_available_at AS "nextAvailableAt"
    `);

    return scheduled.rows.map((row) => ({
      ...row,
      requestedAt:
        typeof row.requestedAt === "string" ? row.requestedAt : row.requestedAt.toISOString(),
      nextAvailableAt:
        typeof row.nextAvailableAt === "string"
          ? row.nextAvailableAt
          : row.nextAvailableAt.toISOString(),
    }));
  });
}

export async function renewProcessingJobLease(
  jobId: string,
  claimToken: string,
  clock: ProcessingJobClock = {}
): Promise<string | null> {
  const expiresAt = new Date(
    (clock.now?.() ?? new Date()).getTime() + (clock.leaseMs ?? DEFAULT_LEASE_MS)
  );
  const renewed = await db
    .update(processingOutbox)
    .set({ claimExpiresAt: expiresAt })
    .where(
      and(
        eq(processingOutbox.id, jobId),
        eq(processingOutbox.status, "claimed"),
        eq(processingOutbox.claimToken, claimToken)
      )
    )
    .returning({ id: processingOutbox.id });
  return renewed.length === 1 ? expiresAt.toISOString() : null;
}
