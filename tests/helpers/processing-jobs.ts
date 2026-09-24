import { and, eq, isNull } from "drizzle-orm";
import type {
  ProcessingCompletionContract,
  ProcessingJobContract,
  ProcessingRecoveryConfig,
  RevisionProcessingRequestContract,
} from "@/server/processing/types";
import type { AIContext } from "@/lib/tasks/types";
import { processRevision } from "@/server/processing/revision-processor";
import { db } from "@/lib/db";
import { processingOutbox, sourceDocumentRevisions, sourceDocuments } from "@/persistence";
import {
  claimProcessingJob,
  completeProcessingJob,
  recoverProcessingJobs,
  renewProcessingJobLease,
  type ProcessingJobClock,
} from "@/server/processing/jobs";

/**
 * Inserts an outbox row for an existing processing revision. Production writes
 * the row in the same transaction as the revision; tests use this to stage a
 * job on its own, and a repeat is a no-op.
 */
export async function dispatchProcessingJob(job: ProcessingJobContract): Promise<void> {
  await db.transaction(async (tx) => {
    const revision = await tx
      .select({
        ledgerId: sourceDocumentRevisions.ledgerId,
        sourceDocumentId: sourceDocumentRevisions.sourceDocumentId,
        processingStatus: sourceDocumentRevisions.processingStatus,
      })
      .from(sourceDocumentRevisions)
      .innerJoin(
        sourceDocuments,
        and(
          eq(sourceDocuments.ledgerId, sourceDocumentRevisions.ledgerId),
          eq(sourceDocuments.id, sourceDocumentRevisions.sourceDocumentId)
        )
      )
      .where(
        and(
          eq(sourceDocumentRevisions.id, job.revisionId),
          eq(sourceDocumentRevisions.sourceDocumentId, job.sourceDocumentId),
          eq(sourceDocuments.latestSubmissionRevisionId, job.revisionId),
          isNull(sourceDocuments.deletedAt)
        )
      )
      .then((rows) => rows[0]);
    if (revision == null || revision.processingStatus !== "processing") return;

    await tx
      .insert(processingOutbox)
      .values({
        id: job.id,
        ledgerId: revision.ledgerId,
        sourceDocumentId: job.sourceDocumentId,
        revisionId: job.revisionId,
        attemptNumber: job.attemptNumber,
        status: "pending",
        requestedAt: new Date(job.requestedAt),
        availableAt: new Date(job.requestedAt),
      })
      .onConflictDoNothing();
  });
}

/** The outbox functions bound to one clock, for tests that walk lease expiry. */
export function processingJobs(clock: ProcessingJobClock = {}) {
  return {
    dispatch: dispatchProcessingJob,
    claim: (jobId: string) => claimProcessingJob(jobId, clock),
    renew: (jobId: string, claimToken: string) => renewProcessingJobLease(jobId, claimToken, clock),
    complete: (result: ProcessingCompletionContract) => completeProcessingJob(result, clock),
    recoverBatch: (ledgerId: string, config: ProcessingRecoveryConfig) =>
      recoverProcessingJobs(ledgerId, config, clock),
  };
}

/** A revision processor whose model calls come from the given AI context. */
export function revisionProcessor(createAIContext: (signal: AbortSignal) => AIContext) {
  return {
    process: (request: RevisionProcessingRequestContract) =>
      processRevision(request, { createAIContext }),
  };
}
