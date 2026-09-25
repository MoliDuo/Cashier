"use server";
import type { DirectUploadPlanContract } from "@/server/stored-files/types";
import { createDirectUploadPlan } from "@/server/stored-files/upload-plans";
import { finalizeDirectUpload } from "@/server/stored-files/upload-finalization";
import {
  createSourceDocumentUploadPlanInputSchema,
  finalizeSourceDocumentUploadInputSchema,
  type CreateSourceDocumentUploadPlanInput,
  type FinalizeSourceDocumentUploadInput,
} from "../contract-schemas";
import { withSourceDocumentLedgerAccess } from "./access";

export const createSourceDocumentUploadPlanAction = withSourceDocumentLedgerAccess(
  async (
    { ledgerId },
    input: CreateSourceDocumentUploadPlanInput
  ): Promise<DirectUploadPlanContract> =>
    createDirectUploadPlan(
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
    const validated = finalizeSourceDocumentUploadInputSchema.parse(input);
    const files = await finalizeDirectUpload({ ...validated, ledgerId });
    return files.map((file) => file.id);
  }
);
