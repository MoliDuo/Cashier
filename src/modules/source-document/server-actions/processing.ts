"use server";

import { cancelSourceDocumentProcessing } from "../server/cancel-processing";
import type { CancelProcessingResponseDto } from "@/modules/source-document/contracts";
import { parseSourceDocumentId } from "@/modules/source-document/contract-schemas";
import { withSourceDocumentLedgerAccess } from "./access";

export const cancelSourceDocumentProcessingAction = withSourceDocumentLedgerAccess(
  async ({ ledgerId }, sourceDocumentId: string): Promise<CancelProcessingResponseDto> =>
    cancelSourceDocumentProcessing(ledgerId, parseSourceDocumentId(sourceDocumentId))
);
