import "server-only";
import type { BatchEntryDateImpact } from "@/modules/ledger/contracts";
import { getBatchEntryDateImpact } from "@/modules/ledger/server/entry-reads/get-batch-entry-date-impact";

/**
 * The date-change preview for a mixed selection: the entries' own impact, plus
 * every selected document — including one with no entries, which still moves.
 */
export async function previewSourceDocumentDateImpact(input: {
  ledgerId: string;
  sourceDocumentIds: readonly string[];
  ledgerEntryIds: readonly string[];
}): Promise<BatchEntryDateImpact> {
  const sourceDocumentIds = [...new Set(input.sourceDocumentIds)];
  if (input.ledgerEntryIds.length === 0) {
    return {
      selectedEntryCount: 0,
      sourceDocumentCount: sourceDocumentIds.length,
      affectedEntryCount: 0,
      sourceDocumentIds,
    };
  }

  const impact = await getBatchEntryDateImpact({
    ledgerId: input.ledgerId,
    ledgerEntryIds: [...input.ledgerEntryIds],
  });
  return {
    ...impact,
    sourceDocumentCount: sourceDocumentIds.length,
    sourceDocumentIds,
  };
}
