"use server";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { withLedgerAccess } from "@/modules/ledger/access";
import { getSourceDocumentInput } from "@/modules/source-document/server/reads/input";
import type { SourceDocumentInputDto } from "@/modules/source-document/contracts";
import { sourceDocumentIdSchema } from "@/modules/source-document/contract-schemas";
import { scheduleProcessingRecoveryAfter } from "@/application/processing/schedule-processing-recovery";

export const getSourceDocumentInputAction = withLedgerAccess(
  async (ledgerId: string, sourceDocumentId: string): Promise<SourceDocumentInputDto> => {
    const parsed = sourceDocumentIdSchema.safeParse(sourceDocumentId);
    if (!parsed.success) {
      throw new ValidationError("Validation failed", { issues: parsed.error.issues });
    }
    scheduleProcessingRecoveryAfter(ledgerId);
    const document = await getSourceDocumentInput(ledgerId, parsed.data);
    if (document == null) throw new NotFoundError("Source document");
    return document;
  }
);
