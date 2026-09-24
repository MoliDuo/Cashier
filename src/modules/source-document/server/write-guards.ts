import { and, eq } from "drizzle-orm";
import { ConflictError } from "@/lib/errors";
import { sourceDocumentRevisions, sourceDocuments } from "@/persistence";
import type { PostgresTransaction } from "@/lib/db/transaction-locks";

export function hasEditableActiveProjection<T extends { activeRevisionId: string | null }>(
  document: T
): document is T & { activeRevisionId: string } {
  return document.activeRevisionId !== null;
}

export async function assertSourceDocumentNotProcessing(
  tx: PostgresTransaction,
  document: Pick<
    typeof sourceDocuments.$inferSelect,
    "ledgerId" | "id" | "latestSubmissionRevisionId"
  >
): Promise<void> {
  if (document.latestSubmissionRevisionId == null) return;
  const revision = await tx
    .select({ processingStatus: sourceDocumentRevisions.processingStatus })
    .from(sourceDocumentRevisions)
    .where(
      and(
        eq(sourceDocumentRevisions.ledgerId, document.ledgerId),
        eq(sourceDocumentRevisions.sourceDocumentId, document.id),
        eq(sourceDocumentRevisions.id, document.latestSubmissionRevisionId)
      )
    )
    .then((rows) => rows[0]);
  if (revision?.processingStatus === "processing") {
    throw new ConflictError("Source document cannot be edited while processing");
  }
}
