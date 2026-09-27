import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { extractionAttempts, sourceDocuments } from "@/persistence";
import { lockLedgerForUpdate, lockSourceDocumentForUpdate } from "@/lib/db/transaction-locks";
import { ledgerScopedAttemptWhere } from "./projections/attempt-guards";
import { activeDocumentWhere } from "./projections/shared";

/**
 * Cancels the document's current processing attempt. The attempt is not part
 * of the record's content (title, date and entries), so the version is left
 * alone.
 */
export async function cancelSourceDocumentProcessing(
  ledgerId: string,
  sourceDocumentId: string
): Promise<{ processingStatus: "cancelled" }> {
  return db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx, ledgerId);
    const document = await lockSourceDocumentForUpdate(tx, ledgerId, sourceDocumentId);
    const attemptId = document.latestAttemptId;
    if (attemptId == null) throw new ConflictError("Source document has no submitted input");

    const now = new Date();
    const attempt = await tx
      .update(extractionAttempts)
      .set({ status: "cancelled", finishedAt: now })
      .where(
        and(
          ledgerScopedAttemptWhere(ledgerId, sourceDocumentId, attemptId),
          eq(extractionAttempts.status, "processing")
        )
      )
      .returning({ id: extractionAttempts.id })
      .then((rows) => rows[0]);
    if (attempt == null) throw new ConflictError("Source document is no longer processing");

    const updated = await tx
      .update(sourceDocuments)
      .set({ updatedAt: now })
      .where(
        and(
          activeDocumentWhere(ledgerId, sourceDocumentId),
          eq(sourceDocuments.latestAttemptId, attemptId)
        )
      )
      .returning({ id: sourceDocuments.id })
      .then((rows) => rows[0]);
    if (updated == null) throw new NotFoundError("Source document");
    return { processingStatus: "cancelled" };
  });
}
