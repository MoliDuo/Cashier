"use server";
import { parseSourceDocumentId } from "@/modules/source-document/contract-schemas";
import { withLedgerAccess } from "@/modules/ledger/access";
import { deleteSourceDocumentAtomically } from "../server/delete";

/**
 * Delete a single source document (soft delete with cascade).
 */
export const deleteSourceDocumentAction = withLedgerAccess(async (sourceId: string) =>
  deleteSourceDocumentAtomically({ sourceDocumentId: parseSourceDocumentId(sourceId) })
);
