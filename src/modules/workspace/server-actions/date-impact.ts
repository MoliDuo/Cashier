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
      ledgerEntryIds: parseLedgerEntryIds(input.ledgerEntryIds),
    })
);
