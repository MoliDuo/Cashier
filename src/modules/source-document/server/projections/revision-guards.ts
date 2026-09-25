import { and, eq } from "drizzle-orm";
import { sourceDocumentRevisions } from "@/persistence";

export function ledgerScopedRevisionWhere(
  ledgerId: string,
  sourceDocumentId: string,
  revisionId: string
) {
  return and(
    eq(sourceDocumentRevisions.ledgerId, ledgerId),
    eq(sourceDocumentRevisions.sourceDocumentId, sourceDocumentId),
    eq(sourceDocumentRevisions.id, revisionId)
  );
}
