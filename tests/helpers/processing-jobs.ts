import type {
  ProcessingRecoveryConfig,
  RevisionProcessingRequestContract,
} from "@/server/processing/types";
import type { AIContext } from "@/lib/tasks/types";
import { processRevision } from "@/server/processing/revision-processor";
import {
  claimProcessingJob,
  recoverProcessingJobs,
  renewProcessingJobLease,
  type ProcessingJobClock,
} from "@/server/processing/jobs";

/** The queue functions bound to one clock, for tests that walk lease expiry. */
export function processingJobs(clock: ProcessingJobClock = {}) {
  return {
    claim: (revisionId: string) => claimProcessingJob(revisionId, clock),
    renew: (revisionId: string, claimToken: string) =>
      renewProcessingJobLease(revisionId, claimToken, clock),
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
