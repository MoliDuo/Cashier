import { db } from "@/lib/db";
import {
  createProcessingRevisionInTransaction,
  type CreatePendingRevisionInput,
} from "@/modules/source-document/server/revisions";

/** Evidence-only fixture for tests that exercise processing jobs separately. */
export function createPendingRevision(input: CreatePendingRevisionInput) {
  return db.transaction((tx) => createProcessingRevisionInTransaction(tx, input));
}

/** Claim the processing attempt before exercising processing terminal writes. */
export async function claimRevisionForTest(revisionId: string) {
  const { processingJobs } = await import("./processing-jobs");
  const claim = await processingJobs().claim(revisionId);
  if (claim == null) throw new Error("Test revision could not be claimed");
  return { revisionId, claimToken: claim.claimToken };
}
