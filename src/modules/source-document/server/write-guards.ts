import { and, eq } from "drizzle-orm";
import { ConflictError } from "@/lib/errors";
import { extractionAttempts, sourceDocuments } from "@/persistence";
import type { PostgresTransaction } from "@/lib/db/transaction-locks";

export async function assertSourceDocumentNotProcessing(
  tx: PostgresTransaction,
  document: Pick<typeof sourceDocuments.$inferSelect, "ledgerId" | "id" | "latestAttemptId">
): Promise<void> {
  if (document.latestAttemptId == null) return;
  const attempt = await tx
    .select({ status: extractionAttempts.status })
    .from(extractionAttempts)
    .where(
      and(
        eq(extractionAttempts.ledgerId, document.ledgerId),
        eq(extractionAttempts.sourceDocumentId, document.id),
        eq(extractionAttempts.id, document.latestAttemptId)
      )
    )
    .then((rows) => rows[0]);
  if (attempt?.status === "processing") {
    throw new ConflictError("Source document cannot be edited while processing");
  }
}
