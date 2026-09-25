import type { SaveSourceDocumentChangesInput } from "@/modules/source-document/contracts";
import type { PendingChanges } from "@/modules/source-document/detail-types";

/**
 * Builds the detail whole-save payload. The document patch names each field
 * instead of forwarding the pending object, so a pending key the server schema
 * does not accept fails to type-check rather than failing validation at save.
 */
export function toSaveSourceDocumentChangesInput(
  sourceDocumentId: string,
  expectedVersion: number,
  changes: PendingChanges
): SaveSourceDocumentChangesInput {
  const { title, documentDate } = changes.sourceDoc;
  const sourceDocument = {
    ...(title === undefined ? {} : { title }),
    ...(documentDate === undefined ? {} : { documentDate }),
  };
  return {
    sourceDocumentId,
    expectedVersion,
    ...(Object.keys(sourceDocument).length === 0 ? {} : { sourceDocument }),
    entries: Object.entries(changes.entries)
      .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
      .map(([ledgerEntryId, data]) => ({ ledgerEntryId, data })),
  };
}
