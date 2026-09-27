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
    UPDATE extraction_attempts attempt
    SET claim_token = NULL, claim_expires_at = NULL
    WHERE attempt.id = ${lease.attemptId}
      AND ${leaseHeldBy(sql`attempt.claim_token`, sql`attempt.claim_expires_at`, lease.claimToken)}
      AND attempt.status = 'processing'
    RETURNING attempt.id
  `);
  return closed.rows.length === 1;
}
