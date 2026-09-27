import { db } from "@/lib/db";
import {
  createProcessingAttemptInTransaction,
  type CreatePendingAttemptInput,
} from "@/modules/source-document/server/extraction-attempts";

/** Evidence-only fixture for tests that exercise processing jobs separately. */
export function createPendingAttempt(input: CreatePendingAttemptInput) {
  return db.transaction((tx) => createProcessingAttemptInTransaction(tx, input));
}

/** Claim the processing attempt before exercising processing terminal writes. */
export async function claimAttemptForTest(attemptId: string) {
  const { processingJobs } = await import("./processing-jobs");
  const claim = await processingJobs().claim(attemptId);
  if (claim == null) throw new Error("Test attempt could not be claimed");
  return { attemptId, claimToken: claim.claimToken };
}
