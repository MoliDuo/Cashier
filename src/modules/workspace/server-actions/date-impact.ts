"use server";

import { withLedgerAccess } from "@/modules/ledger/access";
import { parseLedgerEntryIds } from "@/modules/ledger/contract-schemas";
import { previewSourceDocumentDateImpact } from "@/modules/workspace/server/source-document-date-impact";
import { sourceDocumentIdsSchema } from "@/modules/source-document/contract-schemas";

export const previewSourceDocumentDateImpactAction = withLedgerAccess(
  async (ledgerId: string, input: { sourceDocumentIds: string[]; ledgerEntryIds: string[] }) =>
    previewSourceDocumentDateImpact({
      ledgerId,
      sourceDocumentIds: sourceDocumentIdsSchema.parse(input.sourceDocumentIds),
      // A selection of documents without entries has no entry ids, and still moves.
      ledgerEntryIds:
        input.ledgerEntryIds.length === 0 ? [] : parseLedgerEntryIds(input.ledgerEntryIds),
    })
);
