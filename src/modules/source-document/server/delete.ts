import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  ledgerEntries,
  processingOutbox,
  sourceDocumentRevisions,
  sourceDocuments,
} from "@/persistence";
import { NotFoundError } from "@/lib/errors";
import { db } from "@/lib/db";
import type { DeleteSourceDocumentResultDto } from "@/modules/source-document/contracts";
import type { PostgresTransaction } from "@/lib/db/transaction-locks";
import { lockLedgerForUpdate, lockSourceDocumentForUpdate } from "@/lib/db/transaction-locks";

async function softDeleteLockedSourceDocument(
  tx: PostgresTransaction,
  ledgerId: string,
  document: typeof sourceDocuments.$inferSelect
): Promise<boolean> {
  const sourceDocumentId = document.id;
  const now = new Date();
  if (document.latestSubmissionRevisionId != null) {
    await tx
      .update(sourceDocumentRevisions)
      .set({ processingStatus: "cancelled", finishedAt: now })
      .where(
        and(
          eq(sourceDocumentRevisions.ledgerId, ledgerId),
          eq(sourceDocumentRevisions.id, document.latestSubmissionRevisionId),
          eq(sourceDocumentRevisions.processingStatus, "processing")
        )
      );
  }
  await tx
    .update(processingOutbox)
    .set({
      status: "cancelled",
      completedAt: now,
      claimToken: null,
      claimExpiresAt: null,
      diagnosticCode: "source_document_deleted",
    })
    .where(
      and(
        eq(processingOutbox.ledgerId, ledgerId),
        eq(processingOutbox.sourceDocumentId, sourceDocumentId),
        inArray(processingOutbox.status, ["pending", "claimed"])
      )
    );
  const deleted = await tx
    .update(sourceDocuments)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(sourceDocuments.ledgerId, ledgerId),
        eq(sourceDocuments.id, sourceDocumentId),
        isNull(sourceDocuments.deletedAt)
      )
    )
    .returning({ id: sourceDocuments.id });
  if (deleted.length === 0) return false;
  await tx
    .update(ledgerEntries)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(ledgerEntries.ledgerId, ledgerId),
        eq(ledgerEntries.sourceDocumentId, sourceDocumentId),
        isNull(ledgerEntries.deletedAt)
      )
    );
  return true;
}

export async function deleteSourceDocumentAtomically(input: {
  ledgerId: string;
  sourceDocumentId: string;
}): Promise<DeleteSourceDocumentResultDto> {
  return db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx, input.ledgerId);
    const document = await lockSourceDocumentForUpdate(tx, input.ledgerId, input.sourceDocumentId);
    const deleted = await softDeleteLockedSourceDocument(tx, input.ledgerId, document);
    if (!deleted) throw new NotFoundError("Source document");
    return { sourceDocumentId: input.sourceDocumentId, deleted: true };
  });
}
