"use server";

import { cancelSourceDocumentProcessing } from "../server/cancel-processing";
import { StaleSourceDocumentVersionError } from "@/lib/errors";
import { staleVersionedCommandResult } from "@/modules/source-document/application/versioned-command-result";
import type {
  CancelProcessingResponseDto,
  VersionedCommandResult,
} from "@/modules/source-document/contracts";
import { versionedTargetSchema } from "@/modules/source-document/contract-schemas";
import { withSourceDocumentLedgerAccess } from "./access";

export const cancelSourceDocumentProcessingAction = withSourceDocumentLedgerAccess(
  async (
    { ledgerId },
    sourceDocumentId: string,
    expectedVersion: number
  ): Promise<VersionedCommandResult<CancelProcessingResponseDto>> => {
    const target = versionedTargetSchema.parse({ sourceDocumentId, expectedVersion });
    try {
      const cancelled = await cancelSourceDocumentProcessing(
        ledgerId,
        target.sourceDocumentId,
        target.expectedVersion
      );
      return {
        ok: true,
        sourceDocumentId: target.sourceDocumentId,
        version: cancelled.version,
        data: { processingStatus: cancelled.processingStatus },
      };
    } catch (error) {
      if (error instanceof StaleSourceDocumentVersionError) {
        return staleVersionedCommandResult<CancelProcessingResponseDto>(error);
      }
      throw error;
    }
  }
);
