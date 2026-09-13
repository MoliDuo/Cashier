import type { LedgerSettingsContract } from "@/application/contracts/ledger";
import type { CategoryPresetId } from "@/config/category-presets";

export type LedgerDto = {
  id: string;
  userId: string;
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

export type ServiceCredentialDto = {
  id: string;
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
 * `presetId` + `locale`, so a client cannot invent categories; it only decides
 * where each existing category's entries land.
 */
export interface ApplyCategoryPresetInput {
  expectedRevision: string;
  presetId: CategoryPresetId;
  locale: string;
  mappings: { fromCategoryId: string; toPresetIndex: number | null }[];
}

export interface StartCategoryReclassificationInput {
  ledgerEntryIds: string[];
  candidateCategoryIds: string[];
}

export type CategoryReclassificationStatus = "pending" | "running" | "succeeded" | "failed";

/**
 * A reclassification run as the client sees it. The entry and category id
 * arrays stay on the server; the counts and the derived `undecided` are all
 * the progress display needs.
 */
export interface CategoryReclassificationJobDto {
  id: string;
  status: CategoryReclassificationStatus;
  /** How many entries the run covers. */
  total: number;
  cursor: number;
  /** Entries the model actually moved. */
  appliedCount: number;
  /** Entries the model placed in the category they already had. */
  confirmedCount: number;
  /** `total - appliedCount - confirmedCount`. */
  undecidedCount: number;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}
export type CategoryReclassificationJob = CategoryReclassificationJobDto;

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
