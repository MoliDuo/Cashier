import type { LedgerSettingsContract } from "@/application/contracts/ledger";
import type { CategoryPresetId } from "@/config/category-presets";

export type LedgerDto = {
  id: string;
  settings: LedgerSettingsContract;
  createdAt: string;
  updatedAt: string;
};
export type Ledger = LedgerDto;

export type UpdateLedgerActionErrorCode =
  "rates_unavailable" | "unsupported_currency" | "validation_failed" | "conflict" | "unexpected";

export type UpdateLedgerActionResult =
  | { ok: true; ledger: LedgerDto }
  | { ok: false; code: UpdateLedgerActionErrorCode; dates?: string[] };

export type BookDto = {
  id: string;
  ledgerId: string;
  name: string;
  timeZone: string | null;
  sortOrder: number;
  /** Set while the book is retired; the switcher hides those rows. */
  archivedAt: string | null;
};

export type ServiceCredentialDto = {
  id: string;
  bookId: string;
  tokenPrefix: string;
  tokenSuffix: string;
  ledgerId: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  deletedAt: string | null;
};
export type ServiceCredential = ServiceCredentialDto;

export type CreatedServiceCredentialDto = ServiceCredentialDto & { token: string };
export type CreatedServiceCredential = CreatedServiceCredentialDto;

export type EntryCategoryDto = {
  id: string;
  ledgerId: string;
  name: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
export type EntryCategory = EntryCategoryDto;

export type EntryCategoryWithCountDto = EntryCategoryDto & { entryCount: number };
export type EntryCategoryWithCount = EntryCategoryWithCountDto;

interface SaveEntryCategoryTargetDto {
  id?: string;
  clientId?: string;
  name: string;
  description: string | null;
  icon: string | null;
}

export interface SaveEntryCategoriesInput {
  expectedRevision: string;
  categories: SaveEntryCategoryTargetDto[];
}

/**
 * A preset switch. The preset's category text is resolved on the server from
 * `presetId`, so a client cannot invent categories; it only decides where each
 * existing category's entries land.
 */
export interface ApplyCategoryPresetInput {
  expectedRevision: string;
  presetId: CategoryPresetId;
  mappings: { fromCategoryId: string; toPresetIndex: number | null }[];
}
export interface ApplyCategoryPresetResult {
  categories: EntryCategoryWithCount[];
  changed: boolean;
  movedEntryCount: number;
  createdCategoryCount: number;
  removedCategoryCount: number;
  retainedCategoryCount: number;
}

export interface StartCategoryReclassificationInput {
  ledgerEntryIds: string[];
  candidateCategoryIds: string[];
}

export type CategoryAssignmentMode =
  | { kind: "ai"; candidateCategoryIds: string[] }
  | { kind: "assign"; categoryId: string }
  | { kind: "clear" };
export interface CategoryAssignmentSelectionEntry {
  ledgerEntryId: string;
  sourceDocumentId: string;
  expectedVersion: number;
}
export interface BeginCategoryAssignmentInput {
  requestKey: string;
  mode: CategoryAssignmentMode;
  expectedEntryCount: number;
}
export interface AppendCategoryAssignmentSelectionInput {
  jobId: string;
  chunkIndex: number;
  entries: CategoryAssignmentSelectionEntry[];
}
export interface CommitCategoryAssignmentSelectionInput {
  jobId: string;
  expectedEntryCount: number;
}
export type CategoryAssignmentJobStatus =
  "preparing" | "pending" | "running" | "succeeded" | "partial" | "failed" | "cancelled";
export type CategoryAssignmentEntryOutcome =
  "applied" | "confirmed" | "failed" | "conflict" | "skipped" | "cancelled";
export interface CategoryAssignmentCandidateSnapshot {
  id: string;
  name: string;
  description: string | null;
}

/**
 * A category assignment run as the client sees it. Selection rows stay on the
 * server and every v2 entry has one mutually exclusive final outcome.
 */
export interface CategoryReclassificationJobDto {
  id: string;
  formatVersion: number;
  mode: CategoryAssignmentMode;
  status: CategoryAssignmentJobStatus;
  /** How many entries the run covers. */
  total: number;
  processedCount: number;
  /** Entries the model actually moved. */
  appliedCount: number;
  /** Entries the model placed in the category they already had. */
  confirmedCount: number;
  failedCount: number;
  conflictCount: number;
  skippedCount: number;
  cancelledCount: number;
  documentTotal: number;
  documentCompleted: number;
  activeDocumentCount: number;
  retryingDocumentCount: number;
  nextRetryAt: string | null;
  candidateCategories: CategoryAssignmentCandidateSnapshot[];
  receivedCount: number;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  canRetryFailed: boolean;
  evidenceIncomplete: boolean;
}
export type CategoryReclassificationJob = CategoryReclassificationJobDto;

export interface CategoryAssignmentEntryResultDto {
  ledgerEntryId: string;
  itemName: string | null;
  originalCategoryId: string | null;
  originalCategoryName: string | null;
  targetCategoryId: string | null;
  targetCategoryName: string | null;
  outcome: CategoryAssignmentEntryOutcome | null;
  errorCode: string | null;
}
export interface CategoryAssignmentResultPageDto {
  items: CategoryAssignmentEntryResultDto[];
  nextCursor: number | null;
}

export type SourceDocumentReferenceDto = {
  id: string;
  version: number;
  ledgerId: string;
  title: string | null;
  documentDate: string | null;
  createdAt: string;
  updatedAt: string;
  hasImages?: boolean;
};

export type LedgerEntryDto = {
  id: string;
  ledgerId: string;
  categoryId: string | null;
  sourceDocumentId: string | null;
  amount: string;
  currency: string | null;
  itemName: string;
  description: string | null;
  convertedAmount: string | null;
  exchangeRate: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  category?: EntryCategoryDto | null;
  sourceDocument?: SourceDocumentReferenceDto | null;
};
export type LedgerEntry = LedgerEntryDto;

export type LedgerEntryEmbeddedViewDto = Omit<LedgerEntryDto, "sourceDocument">;

type LedgerSettingsDto = {
  id?: string;
} & LedgerSettingsContract;
export type Settings = LedgerSettingsDto;

export interface LedgerSummaryDto {
  unconvertedCount: number;
  convertedTotal: {
    total: string;
    currency: string;
  } | null;
  totals: {
    currency: string;
    total: string;
    count: number;
  }[];
  trend: {
    date: string;
    total: string;
  }[];
  byCategory: {
    categoryId: string | null;
    categoryName: string;
    categoryIcon: string | null;
    currency: string | null;
    total: string;
    count: number;
  }[];
}
export type LedgerEntrySummary = LedgerSummaryDto;

export interface LedgerEntryPageDto {
  items: LedgerEntryDto[];
  nextCursor: string | null;
}

export interface LedgerSettingsViewDto {
  uncategorizedCount: number;
  credentials: ServiceCredentialDto[];
}

export interface DeleteEntryCategoryResultDto {
  categoryId: string;
  deleted: boolean;
}

export interface ReorderEntryCategoriesResultDto {
  categoryIds: string[];
  reorderedCount: number;
}
