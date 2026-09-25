"use server";
import { parseSourceDocumentId } from "@/modules/source-document/contract-schemas";
import { withSourceDocumentLedgerAccess } from "./access";
import { deleteSourceDocumentAtomically } from "../server/delete";

/**
 * Delete a single source document (soft delete with cascade).
 */
export const deleteSourceDocumentAction = withSourceDocumentLedgerAccess(
  async ({ ledgerId }, sourceId: string) =>
    deleteSourceDocumentAtomically({ ledgerId, sourceDocumentId: parseSourceDocumentId(sourceId) })
);
