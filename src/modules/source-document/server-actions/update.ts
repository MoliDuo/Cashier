"use server";
import type {
  BatchUpdateSourceDocumentsResultDto,
  AtomicBatchCommandResult,
  SaveSourceDocumentChangesInput,
  SaveSourceDocumentChangesResultDto,
  VersionedCommandResult,
} from "@/modules/source-document/contracts";
import {
  batchUpdateSourceDocumentsInputSchema,
  saveSourceDocumentChangesInputSchema,
  type BatchUpdateSourceDocumentsInput,
} from "@/modules/source-document/contract-schemas";
import { withSourceDocumentLedgerAccess } from "./access";
import { saveSourceDocumentChanges, updateSourceDocuments } from "../server/updates";
/**
 * Batch update multiple source documents.
 */
export const batchUpdateSourceDocumentsAction = withSourceDocumentLedgerAccess(
  async (
    { ledgerId },
    input: {
      targets: import("../contracts").VersionedTarget[];
      data: BatchUpdateSourceDocumentsInput;
    }
  ): Promise<AtomicBatchCommandResult<BatchUpdateSourceDocumentsResultDto>> => {
    const validated = batchUpdateSourceDocumentsInputSchema.parse(input);
    return updateSourceDocuments({
      ledgerId,
      targets: validated.targets,
      data: validated.data,
    });
  }
);

export const saveSourceDocumentChangesAction = withSourceDocumentLedgerAccess(
  async (
    { ledgerId },
    input: SaveSourceDocumentChangesInput
  ): Promise<VersionedCommandResult<SaveSourceDocumentChangesResultDto>> => {
    const validated = saveSourceDocumentChangesInputSchema.parse(input);
    return saveSourceDocumentChanges({
      ledgerId,
      sourceDocumentId: validated.sourceDocumentId,
      expectedVersion: validated.expectedVersion,
      ...(validated.sourceDocument === undefined
        ? {}
        : { sourceDocument: validated.sourceDocument }),
      entries: validated.entries,
    });
  }
);
