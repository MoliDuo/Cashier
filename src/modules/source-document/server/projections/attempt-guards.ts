import { and, eq } from "drizzle-orm";
import { extractionAttempts } from "@/persistence";

export function ledgerScopedAttemptWhere(
  ledgerId: string,
  sourceDocumentId: string,
  attemptId: string
) {
  return and(
    eq(extractionAttempts.ledgerId, ledgerId),
    eq(extractionAttempts.sourceDocumentId, sourceDocumentId),
    eq(extractionAttempts.id, attemptId)
  );
}
