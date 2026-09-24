import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { ProcessingLeaseContract } from "@/application/contracts";
import { processingOutbox } from "@/persistence";
import type { PostgresTransaction } from "@/application/adapters/postgres/transaction-locks";

export type ProcessingTerminalStatus = "completed" | "failed";

export async function completeProcessingLeaseInTransaction(
  tx: PostgresTransaction,
  lease: ProcessingLeaseContract,
  processingStatus: ProcessingTerminalStatus,
  diagnostic?: { code?: string | null; correlationId?: string | null }
): Promise<boolean> {
  const now = new Date();
  const row = await tx
    .update(processingOutbox)
    .set({
      status: processingStatus,
      retryClassification: processingStatus === "failed" ? "retryable" : null,
      diagnosticCode: diagnostic?.code ?? null,
      correlationId: diagnostic?.correlationId ?? null,
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
    .returning({
      revisionId: processingOutbox.revisionId,
      attemptNumber: processingOutbox.attemptNumber,
    })
    .then((rows) => rows[0]);
  if (row == null) return false;

  return true;
}
