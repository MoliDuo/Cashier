import { db } from "@/lib/db";
import {
  createProcessingRevisionInTransaction,
  type CreatePendingRevisionInput,
} from "@/modules/source-document/server/revisions";

/** Evidence-only fixture for tests that exercise processing jobs separately. */
export function createPendingRevision(input: CreatePendingRevisionInput) {
  return db.transaction((tx) => createProcessingRevisionInTransaction(tx, input));
}

/** Claim a real durable job before exercising processing terminal writes. */
export async function claimRevisionForTest(revisionId: string) {
  const { eq } = await import("drizzle-orm");
  const { processingOutbox, sourceDocumentRevisions } = await import("@/persistence");
  const { processingJobs } = await import("./processing-jobs");
  const adapter = processingJobs();
  let job = await db.query.processingOutbox.findFirst({
    where: eq(processingOutbox.revisionId, revisionId),
  });
  if (job == null) {
    const revision = await db.query.sourceDocumentRevisions.findFirst({
      where: eq(sourceDocumentRevisions.id, revisionId),
    });
    if (revision == null) throw new Error("Test revision missing");
    const id = crypto.randomUUID();
    await adapter.dispatch({
      id,
      sourceDocumentId: revision.sourceDocumentId,
      revisionId,
      requestedAt: new Date().toISOString(),
    });
    job = await db.query.processingOutbox.findFirst({ where: eq(processingOutbox.id, id) });
  }
  if (job == null) throw new Error("Test job missing");
  const claim = await adapter.claim(job.id);
  if (claim == null) throw new Error("Test job could not be claimed");
  return { jobId: claim.job.id, claimToken: claim.claimToken };
}
