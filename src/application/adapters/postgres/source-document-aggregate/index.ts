import type { SourceDocumentAggregateWritePort } from "@/modules/source-document/application/ports";
import { postgresLedgerEntryCommandAdapter } from "../ledger-entry-commands";
import { postgresLedgerProjectionAdapter } from "../ledger-projections";
import { cancelSourceDocumentProcessing } from "../ledger-projections/cancel-source-document-processing";
import { postgresSourceDocumentSubmissionAdapter } from "../submissions";
import {
  assignBook,
  saveChanges,
  updateDocuments,
  updateEntryDates,
} from "../source-document-updates";
import { splitSourceDocumentAtomically } from "../source-document-splits";
import { deleteSourceDocumentAtomically } from "../source-document-delete";
import {
  applyDateOrganization,
  dismissDateOrganization,
} from "../source-document-date-organization";
import { applyCategoryAssignments } from "./category-assignments";

export const postgresSourceDocumentAggregateAdapter: SourceDocumentAggregateWritePort = {
  assignBook,
  applyCategoryAssignments,
  createProcessingDocument: (input) => postgresSourceDocumentSubmissionAdapter.submit(input),
  createIdempotentProcessingDocument: (idempotency, prepare) =>
    postgresSourceDocumentSubmissionAdapter.submitIdempotently(idempotency, prepare),
  createManualDocument: (input) => postgresLedgerProjectionAdapter.createManual(input),
  saveChanges,
  updateDocuments,
  updateEntryDates,
  addEntry: (input) => postgresLedgerEntryCommandAdapter.create(input),
  updateEntries: (input) => postgresLedgerEntryCommandAdapter.update(input),
  deleteEntries: (input) => postgresLedgerEntryCommandAdapter.delete(input),
  batchUpdateEntries: (input) => postgresLedgerEntryCommandAdapter.batchUpdate(input),
  batchDeleteEntries: (input) => postgresLedgerEntryCommandAdapter.batchDelete(input),
  splitEntries: splitSourceDocumentAtomically,
  applyDateOrganization,
  dismissDateOrganization,
  installRetry: (input) => postgresSourceDocumentSubmissionAdapter.submit(input),
  cancelProcessing: cancelSourceDocumentProcessing,
  deleteDocuments: deleteSourceDocumentAtomically,
};
