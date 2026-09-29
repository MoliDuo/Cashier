"use server";

import { cancelSourceDocumentProcessing } from "../server/cancel-processing";
import type { CancelProcessingResponseDto } from "@/modules/source-document/contracts";
import { parseSourceDocumentId } from "@/modules/source-document/contract-schemas";
import { withLedgerAccess } from "@/modules/ledger/access";

export const cancelSourceDocumentProcessingAction = withLedgerAccess(
  async (sourceDocumentId: string): Promise<CancelProcessingResponseDto> =>
    cancelSourceDocumentProcessing(parseSourceDocumentId(sourceDocumentId))
);
