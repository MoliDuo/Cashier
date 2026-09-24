import type {
  LedgerId,
  ProcessingLeaseContract,
  RevisionId,
  SourceDocumentId,
} from "./source-documents";

export interface CurrencyPort {
  recalculateLedgerForDate(ledgerId: LedgerId, date: string): Promise<number>;
}
export interface LedgerProjectionEntryContract {
  id?: string;
  categoryId: string | null;
  amount: string;
  currency: string | null;
  itemName: string;
  description: string | null;
  convertedAmount: string | null;
  exchangeRate: string | null;
  createdAt?: string;
  dateHint?: import("@/modules/source-document/date-organization-contracts").DateHint;
}

export interface LedgerProjectionPort {
  activateRevision(input: {
    ledgerId: LedgerId;
    expectedMainCurrency: string;
    sourceDocumentId: SourceDocumentId;
    revisionId: RevisionId;
    title?: string | null;
    entries: readonly LedgerProjectionEntryContract[];
    dateOrganizationSuggestion?:
      | import("@/modules/source-document/date-organization-contracts").DateOrganizationSuggestion
      | null;
    lease: ProcessingLeaseContract;
  }): Promise<boolean>;
  createManual(input: {
    ledgerId: LedgerId;
    bookId: string;
    expectedMainCurrency: string;
    sourceDocumentId?: SourceDocumentId;
    inputText?: string | null;
    title?: string | null;
    entryDate?: string | null;
    entries: readonly LedgerProjectionEntryContract[];
  }): Promise<{ sourceDocumentId: SourceDocumentId; revisionId: RevisionId }>;
}
