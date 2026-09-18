import type {
  SourceDocumentDetailDto,
  SourceDocumentStoredFileDto,
  SourceDocumentListItemDto,
  SourceDocumentActiveResultSummary,
  SourceDocumentLedgerEntryDto,
} from "@/modules/source-document/contracts";
import {
  PROCESSING_FAILURE_CODES,
  type ApplicationErrorCode,
  type ProcessingFailureCode,
} from "@/application/contracts";
import { deriveSourceDocumentCapabilities } from "@/modules/source-document/application/source-document-state";
import { compare as decimalCompare, round as decimalRound } from "@/lib/money/decimal";
import type { SourceDocumentProcessingStatus } from "@/modules/source-document/types";

export interface SourceDocumentRow {
  id: string;
  ledgerId: string;
  title: string | null;
  bookId?: string | null;
  documentDate: string | null;
  effectiveDate: string;
  activeRevisionId: string | null;
  latestSubmissionRevisionId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  dateOrganizationSuggestion:
    | import("@/modules/source-document/date-organization-contracts").DateOrganizationSuggestion
    | null;
}

export interface SourceDocumentHydrationRow {
  documentId: string;
  selectedRevisionId: string | null;
  activeRevisionId: string | null;
  revisionTitle: string | null;
  inputText: string | null;
  processingStatus: SourceDocumentProcessingStatus | null;
  failureKind: "invalid_input" | "processing_error" | null;
  failureMessage: string | null;
  failureCode: string | null;
  hasImages: boolean;
  files: SourceDocumentStoredFileAggregateRow[];
  ledgerEntries: SourceDocumentLedgerEntryAggregateRow[];
  activeResultSummary: SourceDocumentActiveResultSummary | null;
}

export interface SourceDocumentStoredFileAggregateRow {
  id: string;
  contentType: string;
  byteSize: number;
  originalFilename: string | null;
}

interface SourceDocumentEntryCategoryAggregateRow {
  id: string;
  ledgerId: string;
  name: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface SourceDocumentLedgerEntryAggregateRow {
  id: string;
  ledgerId: string;
  categoryId: string | null;
  sourceDocumentId: string;
  amount: string;
  currency: string;
  itemName: string;
  description: string | null;
  convertedAmount: string | null;
  exchangeRate: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  category: SourceDocumentEntryCategoryAggregateRow | null;
}

export function mapStoredFileDto(file: {
  id: string;
  contentType: string;
  byteSize: number;
  originalFilename: string | null;
}): SourceDocumentStoredFileDto {
  return {
    id: file.id,
    contentType: file.contentType,
    byteSize: file.byteSize,
    originalFilename: file.originalFilename,
  };
}

function mapLedgerEntryAggregateDto(
  entry: SourceDocumentLedgerEntryAggregateRow
): SourceDocumentLedgerEntryDto {
  return {
    id: entry.id,
    ledgerId: entry.ledgerId,
    categoryId: entry.categoryId,
    sourceDocumentId: entry.sourceDocumentId,
    amount: entry.amount,
    currency: entry.currency,
    itemName: entry.itemName,
    description: entry.description,
    convertedAmount: entry.convertedAmount,
    exchangeRate:
      entry.exchangeRate != null && decimalCompare(entry.exchangeRate, "1") === 0
        ? "1"
        : entry.exchangeRate,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    deletedAt: entry.deletedAt,
    ...(entry.category == null ? {} : { category: entry.category }),
  };
}

export function effectiveDocumentTitle(
  documentTitle: string | null | undefined,
  revisionTitle: string | null | undefined
): string | null {
  for (const value of [documentTitle, revisionTitle]) {
    const normalized = value?.trim();
    if (normalized != null && normalized !== "") return normalized;
  }
  return null;
}

export function mapListItem(
  row: SourceDocumentRow,
  hydration: SourceDocumentHydrationRow
): SourceDocumentListItemDto {
  const capabilities = deriveSourceDocumentCapabilities({
    activeRevisionId: row.activeRevisionId,
    latestSubmissionStatus: hydration.processingStatus,
    hasSubmissionInput: row.latestSubmissionRevisionId != null,
  });
  const item: SourceDocumentListItemDto = {
    id: row.id,
    bookId: row.bookId ?? null,
    version: row.version,
    ledgerId: row.ledgerId,
    title: effectiveDocumentTitle(row.title, hydration.revisionTitle),
    text: null,
    processingStatus: hydration.processingStatus,
    failureKind: hydration.failureKind,
    failureMessage: hydration.failureMessage,
    documentDate: row.documentDate,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    hasImages: hydration.hasImages,
    supportedActions: [...capabilities.supportedActions],
    canEdit: capabilities.canEdit,
    errorCode: sanitizedErrorCode(
      hydration.processingStatus,
      hydration.failureKind,
      hydration.failureCode
    ),
  };
  return item;
}

export function mapSourceDocumentDetail(
  row: SourceDocumentRow,
  hydration: SourceDocumentHydrationRow
): SourceDocumentDetailDto {
  const activeResultSummary =
    hydration.activeResultSummary == null
      ? null
      : {
          entryCount: Number(hydration.activeResultSummary.entryCount),
          total: decimalRound(String(hydration.activeResultSummary.total), 2),
        };
  const capabilities = deriveSourceDocumentCapabilities({
    activeRevisionId: row.activeRevisionId,
    latestSubmissionStatus: hydration.processingStatus,
    hasSubmissionInput: row.latestSubmissionRevisionId != null,
  });
  return {
    id: row.id,
    bookId: row.bookId ?? null,
    version: row.version,
    ledgerId: row.ledgerId,
    title: effectiveDocumentTitle(row.title, hydration.revisionTitle),
    text: hydration.inputText,
    files: hydration.files.map(mapStoredFileDto),
    ledgerEntries: hydration.ledgerEntries.map(mapLedgerEntryAggregateDto),
    processingStatus: hydration.processingStatus,
    failureKind: hydration.failureKind,
    failureMessage: hydration.failureMessage,
    documentDate: row.documentDate,
    metadata: {},
    dateOrganizationSuggestion: row.dateOrganizationSuggestion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: null,
    hasImages: hydration.hasImages,
    supportedActions: [...capabilities.supportedActions],
    canEdit: capabilities.canEdit,
    errorCode: sanitizedErrorCode(
      hydration.processingStatus,
      hydration.failureKind,
      hydration.failureCode
    ),
    ...(activeResultSummary == null ? {} : { activeResultSummary }),
  };
}

function sanitizedErrorCode(
  processingStatus: string | null | undefined,
  failureKind: "invalid_input" | "processing_error" | null | undefined,
  failureCode: string | null | undefined
): ApplicationErrorCode | ProcessingFailureCode | null {
  if (processingStatus !== "failed") return null;
  if (failureKind === "invalid_input") return "VALIDATION_FAILED";
  const allowed: readonly ApplicationErrorCode[] = [
    "VALIDATION_FAILED",
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "NOT_FOUND",
    "CONFLICT",
    "RATE_LIMITED",
    "PROCESSING_UNAVAILABLE",
    "STORAGE_UNAVAILABLE",
    "INTERNAL",
  ];
  if (allowed.includes(failureCode as ApplicationErrorCode)) {
    return failureCode as ApplicationErrorCode;
  }
  if (
    failureCode != null &&
    (PROCESSING_FAILURE_CODES as readonly string[]).includes(failureCode)
  ) {
    return failureCode as ProcessingFailureCode;
  }
  return "PROCESSING_UNAVAILABLE";
}
