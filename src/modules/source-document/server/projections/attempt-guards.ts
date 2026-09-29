import { and, eq } from "drizzle-orm";
import { extractionAttempts } from "@/persistence";

export function documentAttemptWhere(sourceDocumentId: string, attemptId: string) {
  return and(
    eq(extractionAttempts.sourceDocumentId, sourceDocumentId),
    eq(extractionAttempts.id, attemptId)
  );
}
