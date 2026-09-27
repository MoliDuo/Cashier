"use server";
import type { BatchUpdateSourceDocumentsResultDto } from "@/modules/source-document/contracts";
import {
  batchUpdateSourceDocumentsInputSchema,
  type BatchUpdateSourceDocumentsInput,
} from "@/modules/source-document/contract-schemas";
import { withSourceDocumentLedgerAccess } from "./access";
import { updateSourceDocuments } from "../server/updates";
/**
 * Batch update multiple source documents.
 */
export const batchUpdateSourceDocumentsAction = withSourceDocumentLedgerAccess(
  async (
    { ledgerId },
    input: {
      sourceDocumentIds: string[];
      data: BatchUpdateSourceDocumentsInput;
    }
  ): Promise<BatchUpdateSourceDocumentsResultDto> => {
    const validated = batchUpdateSourceDocumentsInputSchema.parse(input);
    return updateSourceDocuments({
      ledgerId,
      sourceDocumentIds: validated.sourceDocumentIds,
      data: validated.data,
    });
  }
);
