import { and, eq } from "drizzle-orm";
import { StaleSourceDocumentVersionError } from "@/lib/errors";
import { sourceDocumentRevisions } from "@/persistence";

export function assertExpectedSourceDocumentVersion(
  sourceDocumentId: string,
  expectedVersion: number,
  actualVersion: number
) {
  if (actualVersion !== expectedVersion) {
    throw new StaleSourceDocumentVersionError(sourceDocumentId, expectedVersion, actualVersion);
  }
}

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
