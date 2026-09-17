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
import { serverComposition } from "@/application/server-composition-root";
import { z } from "zod";
import { isCoupleMember } from "@/lib/couple-config";
import { ValidationError } from "@/lib/errors";

export const assignSourceDocumentAttributionAction = withSourceDocumentLedgerAccess(
  async (
    { ledgerId },
    input: { sourceDocumentId: string; expectedVersion: number; attributedUserId: string }
  ) => {
    const validated = z
      .object({
        sourceDocumentId: z.string().uuid(),
        expectedVersion: z.number().int().positive(),
        attributedUserId: z.string().uuid(),
      })
      .strict()
      .parse(input);
    if (!isCoupleMember(validated.attributedUserId))
      throw new ValidationError("Invalid member attribution");
    return serverComposition.sourceDocumentAggregate.assignAttribution({ ledgerId, ...validated });
  }
);

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
    return serverComposition.sourceDocumentAggregate.updateDocuments({
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
    return serverComposition.sourceDocumentAggregate.saveChanges({
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
