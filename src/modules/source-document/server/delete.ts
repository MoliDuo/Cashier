import { and, eq } from "drizzle-orm";
import { sourceDocuments } from "@/persistence";
import { NotFoundError } from "@/lib/errors";
import { db } from "@/lib/db";
import type { DeleteSourceDocumentResultDto } from "@/modules/source-document/contracts";
import { lockLedgerForUpdate, lockSourceDocumentForUpdate } from "@/lib/db/transaction-locks";

/**
 * Deletes a document outright. Its entries, revisions, file links and category
 * assignment work go with it by cascade; the stored files themselves stay. A
 * worker still processing the document loses its revision, and with it the
 * lease it would finish under.
 */
export async function deleteSourceDocumentAtomically(input: {
  ledgerId: string;
  sourceDocumentId: string;
}): Promise<DeleteSourceDocumentResultDto> {
  return db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx, input.ledgerId);
    await lockSourceDocumentForUpdate(tx, input.ledgerId, input.sourceDocumentId);
    const deleted = await tx
      .delete(sourceDocuments)
      .where(
        and(
          eq(sourceDocuments.ledgerId, input.ledgerId),
          eq(sourceDocuments.id, input.sourceDocumentId)
        )
      )
      .returning({ id: sourceDocuments.id });
    if (deleted.length === 0) throw new NotFoundError("Source document");
    return { sourceDocumentId: input.sourceDocumentId, deleted: true };
  });
}
