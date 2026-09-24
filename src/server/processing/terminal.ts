import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { ProcessingLeaseContract } from "@/server/processing/types";
import { processingOutbox } from "@/persistence";
import type { PostgresTransaction } from "@/lib/db/transaction-locks";

export type ProcessingTerminalStatus = "completed" | "failed";

export async function completeProcessingLeaseInTransaction(
  tx: PostgresTransaction,
  lease: ProcessingLeaseContract,
  processingStatus: ProcessingTerminalStatus,
  diagnostic?: { code?: string | null }
): Promise<boolean> {
  const now = new Date();
  const closed = await tx
    .update(processingOutbox)
    .set({
      status: processingStatus,
      diagnosticCode: diagnostic?.code ?? null,
      completedAt: now,
      claimToken: null,
      claimExpiresAt: null,
    })
    .where(
      and(
        eq(processingOutbox.id, lease.jobId),
        eq(processingOutbox.status, "claimed"),
        eq(processingOutbox.claimToken, lease.claimToken),
        sql`${processingOutbox.claimExpiresAt} > now()`
      )
    )
    .returning({ id: processingOutbox.id });
  return closed.length === 1;
}
