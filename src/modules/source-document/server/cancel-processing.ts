import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { processingOutbox, sourceDocumentRevisions, sourceDocuments } from "@/persistence";
import { lockLedgerForUpdate, lockSourceDocumentForUpdate } from "@/lib/db/transaction-locks";
import { ledgerScopedRevisionWhere } from "./projections/revision-guards";
import { activeDocumentWhere } from "./projections/shared";

/**
 * Cancels the document's current processing attempt. The attempt is not part
 * of what a whole-document save writes, so the version is left alone.
 */
export async function cancelSourceDocumentProcessing(
  ledgerId: string,
  sourceDocumentId: string
): Promise<{ processingStatus: "cancelled" }> {
  return db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx, ledgerId);
    const document = await lockSourceDocumentForUpdate(tx, ledgerId, sourceDocumentId);
    const revisionId = document.latestSubmissionRevisionId;
    if (revisionId == null) throw new ConflictError("Source document has no submitted input");

    const now = new Date();
    const revision = await tx
      .update(sourceDocumentRevisions)
      .set({ processingStatus: "cancelled", finishedAt: now })
      .where(
        and(
          ledgerScopedRevisionWhere(ledgerId, sourceDocumentId, revisionId),
          eq(sourceDocumentRevisions.processingStatus, "processing")
        )
      )
      .returning({ id: sourceDocumentRevisions.id })
      .then((rows) => rows[0]);
    if (revision == null) throw new ConflictError("Source document is no longer processing");

    await tx
      .update(processingOutbox)
      .set({ status: "cancelled", completedAt: now, claimToken: null, claimExpiresAt: null })
      .where(
        and(
          eq(processingOutbox.revisionId, revisionId),
          inArray(processingOutbox.status, ["pending", "claimed"])
        )
      );

    const updated = await tx
      .update(sourceDocuments)
      .set({ updatedAt: now })
      .where(
        and(
          activeDocumentWhere(ledgerId, sourceDocumentId),
          eq(sourceDocuments.latestSubmissionRevisionId, revisionId)
        )
      )
      .returning({ id: sourceDocuments.id })
      .then((rows) => rows[0]);
    if (updated == null) throw new NotFoundError("Source document");
    return { processingStatus: "cancelled" };
  });
}
