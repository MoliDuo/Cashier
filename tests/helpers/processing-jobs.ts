import { eq } from "drizzle-orm";
import type { RevisionProcessingRequestContract } from "@/server/processing/types";
import type { AIContext } from "@/lib/tasks/types";
import { processRevision } from "@/server/processing/revision-processor";
import {
  claimProcessingJob,
  recoverProcessingJobs,
  renewProcessingJobLease,
} from "@/server/processing/jobs";
import { sourceDocumentRevisions } from "@/persistence";
import { getTestDb } from "../setup";

/** The processing queue functions under test. */
export function processingJobs() {
  return {
    claim: (revisionId: string) => claimProcessingJob(revisionId),
    renew: (revisionId: string, claimToken: string) =>
      renewProcessingJobLease(revisionId, claimToken),
    recoverBatch: (ledgerId: string, maxBatch: number) => recoverProcessingJobs(ledgerId, maxBatch),
    /** Leases run on the database clock, so a test expires one by moving it into the past. */
    expireLease: (revisionId: string) =>
      getTestDb()
        .update(sourceDocumentRevisions)
        .set({ claimExpiresAt: new Date(Date.now() - 60_000) })
        .where(eq(sourceDocumentRevisions.id, revisionId)),
  };
}

/** A revision processor whose model calls come from the given AI context. */
export function revisionProcessor(createAIContext: (signal: AbortSignal) => AIContext) {
  return {
    process: (request: RevisionProcessingRequestContract) =>
      processRevision(request, { createAIContext }),
  };
}
