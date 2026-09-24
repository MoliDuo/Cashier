"use server";
import { versionedTargetSchema } from "@/modules/source-document/contract-schemas";
import { withSourceDocumentLedgerAccess } from "./access";
import { deleteSourceDocumentAtomically } from "../server/delete";

/**
 * Delete a single source document (soft delete with cascade).
 */
export const deleteSourceDocumentAction = withSourceDocumentLedgerAccess(
  async ({ ledgerId }, sourceId: string, expectedVersion: number) => {
    const target = versionedTargetSchema.parse({
      sourceDocumentId: sourceId,
      expectedVersion,
    });
    return deleteSourceDocumentAtomically({ ledgerId, target });
  }
);
