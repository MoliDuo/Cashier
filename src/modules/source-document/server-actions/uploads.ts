"use server";
import type { DirectUploadPlanContract } from "@/server/stored-files/types";
import { finalizeDirectUpload, planDirectUpload } from "@/server/stored-files/uploads";
import {
  createSourceDocumentUploadPlanInputSchema,
  finalizeSourceDocumentUploadInputSchema,
  type CreateSourceDocumentUploadPlanInput,
  type FinalizeSourceDocumentUploadInput,
} from "../contract-schemas";
import { withLedgerAccess } from "@/modules/ledger/access";

export const createSourceDocumentUploadPlanAction = withLedgerAccess(
  async (input: CreateSourceDocumentUploadPlanInput): Promise<DirectUploadPlanContract> =>
    planDirectUpload(
      createSourceDocumentUploadPlanInputSchema.parse(input).map((file) => ({
        contentType: file.contentType,
        byteSize: file.byteSize,
        originalFilename: file.originalFilename,
        ...(file.checksum === undefined ? {} : { checksum: file.checksum }),
      }))
    )
);

export const finalizeSourceDocumentUploadAction = withLedgerAccess(
  async (input: FinalizeSourceDocumentUploadInput): Promise<string[]> => {
    const validated = finalizeSourceDocumentUploadInputSchema.parse(input);
    const files = await finalizeDirectUpload(validated);
    return files.map((file) => file.id);
  }
);
