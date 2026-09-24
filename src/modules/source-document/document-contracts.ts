import type { SourceDocumentProcessingStatus } from "./types";
import type { LedgerEntryEmbeddedViewDto } from "@/modules/ledger/contracts";
import type {
  ProcessingFailureCode,
  RevisionFailureKind,
  SupportedSourceDocumentAction,
} from "@/application/contracts";

export interface SourceDocumentStoredFileDto {
  id: string;
  contentType: string;
  byteSize: number;
  originalFilename: string | null;
}

export type SourceDocumentLedgerEntryDto = LedgerEntryEmbeddedViewDto;

interface SourceDocumentSummaryDto {
  id: string;
  bookId?: string | null;
  version: number;
  ledgerId: string;
  title: string | null;
  processingStatus: SourceDocumentProcessingStatus | null;
  failureKind: RevisionFailureKind | null;
  failureMessage: string | null;
  documentDate: string | null;
  createdAt: string;
  updatedAt: string;
  supportedActions: SupportedSourceDocumentAction[];
  canEdit: boolean;
  errorCode: ProcessingFailureCode | null;
}

interface SourceDocumentInputDataDto {
  text: string | null;
  files: SourceDocumentStoredFileDto[];
}

export interface SourceDocumentDetailDto
  extends SourceDocumentSummaryDto, SourceDocumentInputDataDto {
  ledgerEntries: SourceDocumentLedgerEntryDto[];
  hasImages: boolean;
  activeResultSummary?: SourceDocumentActiveResultSummary;
  dateOrganizationSuggestion?:
    import("./date-organization-contracts").DateOrganizationSuggestion | null;
}

export interface SourceDocumentActiveResultSummary {
  entryCount: number;
  total: string;
}

export interface SourceDocumentListItemDto extends SourceDocumentSummaryDto {
  text: null;
  ledgerEntries?: SourceDocumentLedgerEntryDto[];
  hasImages: boolean;
}

export interface StreamPage {
  items: SourceDocumentListItemDto[];
  nextCursor: string | null;
  generation: string;
  hasTransitionalWork: boolean;
  /** When true, indicates the cursor was invalid — the client should discard
   *  all cached pages and restart the stream from page one. */
  restartRequired?: boolean;
}

export interface StreamTotalDto {
  total: string;
  unconvertedCount: number;
}

export interface SourceDocumentInputDto extends SourceDocumentInputDataDto {
  id: string;
  processingStatus: SourceDocumentProcessingStatus | null;
  documentDate: string | null;
  createdAt: string;
}
