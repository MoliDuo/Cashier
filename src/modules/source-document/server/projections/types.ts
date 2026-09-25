import type { ProcessingLeaseContract } from "@/server/processing/types";
import type {
  DateHint,
  DateOrganizationSuggestion,
} from "@/modules/source-document/date-organization-contracts";

export interface LedgerProjectionEntryContract {
  id?: string;
  categoryId: string | null;
  amount: string;
  currency: string | null;
  itemName: string;
  description: string | null;
  createdAt?: string;
  dateHint?: DateHint;
}

export interface ActivateRevisionInput {
  ledgerId: string;
  sourceDocumentId: string;
  revisionId: string;
  title?: string | null;
  entries: readonly LedgerProjectionEntryContract[];
  dateOrganizationSuggestion?: DateOrganizationSuggestion | null;
  lease: ProcessingLeaseContract;
}

export interface CreateManualDocumentInput {
  ledgerId: string;
  bookId: string;
  sourceDocumentId?: string;
  inputText?: string | null;
  title?: string | null;
  entryDate?: string | null;
  entries: readonly LedgerProjectionEntryContract[];
}
