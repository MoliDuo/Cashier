"use server";
import { serverComposition } from "@/application/server-composition-root";
import type { DirectUploadPlanContract } from "@/application/contracts";
import {
  createSourceDocumentUploadPlanInputSchema,
  finalizeSourceDocumentUploadInputSchema,
  type CreateSourceDocumentUploadPlanInput,
  type FinalizeSourceDocumentUploadInput,
} from "../contract-schemas";
import { withSourceDocumentLedgerAccess } from "./access";
import { scheduleRequestMaintenance } from "@/application/transport/request-maintenance";

export const createSourceDocumentUploadPlanAction = withSourceDocumentLedgerAccess(
  async (
    { ledgerId },
    input: CreateSourceDocumentUploadPlanInput
  ): Promise<DirectUploadPlanContract> =>
    serverComposition.storedFiles.createDirectUploadPlan(
      ledgerId,
      createSourceDocumentUploadPlanInputSchema.parse(input).map((file) => ({
        contentType: file.contentType,
        byteSize: file.byteSize,
        originalFilename: file.originalFilename,
        ...(file.checksum === undefined ? {} : { checksum: file.checksum }),
      }))
    )
);

export const finalizeSourceDocumentUploadAction = withSourceDocumentLedgerAccess(
  async ({ ledgerId }, input: FinalizeSourceDocumentUploadInput): Promise<string[]> => {
    scheduleRequestMaintenance();
    const validated = finalizeSourceDocumentUploadInputSchema.parse(input);
    const files = await serverComposition.storedFiles.finalizeBrowserUpload({
      ...validated,
      ownerLedgerId: ledgerId,
    });
    return files.map((file) => file.id);
  }
);
