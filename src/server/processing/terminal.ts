import "server-only";
import { sql } from "drizzle-orm";
import type { ProcessingLeaseContract } from "@/server/processing/types";
import type { PostgresTransaction } from "@/lib/db/transaction-locks";

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
    UPDATE source_document_revisions
    SET claim_token = NULL, claim_expires_at = NULL
    WHERE id = ${lease.revisionId}
      AND claim_token = ${lease.claimToken}
      AND claim_expires_at > now()
      AND processing_status = 'processing'
    RETURNING id
  `);
  return closed.rows.length === 1;
}
