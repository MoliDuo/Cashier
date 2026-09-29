import { and, eq, inArray } from "drizzle-orm";
import { ConflictError } from "@/lib/errors";
import { extractionAttempts, sourceDocuments } from "@/persistence";
import type { PostgresTransaction } from "@/lib/db/transaction-locks";

/**
 * Refuses a hand edit while any of the documents is being processed, since
 * the parse replaces its entries when it completes. One query however many
 * documents; the latest-attempt foreign key keeps each attempt on its document.
 */
export async function assertSourceDocumentsNotProcessing(
  tx: PostgresTransaction,
  documents: readonly Pick<typeof sourceDocuments.$inferSelect, "latestAttemptId">[]
): Promise<void> {
  const attemptIds = documents.flatMap((document) =>
    document.latestAttemptId == null ? [] : [document.latestAttemptId]
  );
  if (attemptIds.length === 0) return;
  const processing = await tx
    .select({ id: extractionAttempts.id })
    .from(extractionAttempts)
    .where(
      and(inArray(extractionAttempts.id, attemptIds), eq(extractionAttempts.status, "processing"))
    )
    .limit(1);
  if (processing.length > 0) {
    throw new ConflictError("Source document cannot be edited while processing");
  }
}
