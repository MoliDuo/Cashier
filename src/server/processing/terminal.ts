import "server-only";
import { sql } from "drizzle-orm";
import type { ProcessingLeaseContract } from "@/server/processing/types";
import type { PostgresTransaction } from "@/lib/db/transaction-locks";
import { leaseHeldBy } from "@/lib/db/lease";

/**
 * Releases the worker's lease on a processing attempt the caller is about to
 * finish. Returns false when the lease was lost, reclaimed or the attempt is no
 * longer processing, so a late worker cannot commit stale results.
 */
export async function closeProcessingLeaseInTransaction(
  tx: PostgresTransaction,
  lease: ProcessingLeaseContract
): Promise<boolean> {
  const closed = await tx.execute(sql`
    UPDATE source_document_revisions revision
    SET claim_token = NULL, claim_expires_at = NULL
    WHERE revision.id = ${lease.revisionId}
      AND ${leaseHeldBy(sql`revision.claim_token`, sql`revision.claim_expires_at`, lease.claimToken)}
      AND revision.processing_status = 'processing'
    RETURNING revision.id
  `);
  return closed.rows.length === 1;
}
