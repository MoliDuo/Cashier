import type { z } from "zod";
import type {
  saveSourceDocumentChangesInputSchema,
  splitSourceDocumentInputSchema,
} from "./contract-schemas";

import type { SourceDocumentProcessingStatus } from "./types";

export type { SourceDocumentProcessingStatus };
export type {
  SourceDocumentActiveResultSummary,
  SourceDocumentDetailDto,
  SourceDocumentInputDto,
  SourceDocumentLedgerEntryDto,
  SourceDocumentListItemDto,
  SourceDocumentStoredFileDto,
  StreamPage,
  StreamTotalDto,
} from "./document-contracts";
export type { SourceDocumentDetailDto as SourceDocument } from "./document-contracts";

export interface CreateSourceDocumentResponseDto {
  sourceDocumentId: string;
  version: 1;
  status: "processing";
}

export interface VersionedTarget {
  sourceDocumentId: string;
  expectedVersion: number;
}

export type VersionedCommandResult<T> =
  | { ok: true; sourceDocumentId: string; version: number; data: T }
  | {
      ok: false;
      reason: "stale";
      sourceDocumentId: string;
      expectedVersion: number;
      currentVersion: number;
    };

/**
 * Transaction semantics: one atomic transaction covers every target. If any
 * target's `version` no longer matches its `expectedVersion`, the whole
 * command rolls back with zero writes — `staleTargets` lists every mismatched
 * target, not just the first. On success, every target advanced together in
 * that same transaction.
 */
export type AtomicBatchCommandResult<T> =
  | { ok: true; versions: Array<{ sourceDocumentId: string; version: number }>; data: T }
  | {
      ok: false;
      reason: "stale";
      staleTargets: Array<{
        sourceDocumentId: string;
        expectedVersion: number;
        currentVersion: number;
      }>;
    };

/**
 * Transaction semantics: one transaction per document, not one for the whole
 * batch. Entries belonging to the same document either all succeed or all
 * roll back together (that document lands in exactly one of `succeeded`,
 * `stale`, or `failed`), but different documents commit independently — one
 * document's stale version or failure never blocks or rolls back another's.
 */
export interface PartialBatchCommandResult<TId extends string = string> {
  succeeded: Array<{ id: TId; sourceDocumentId: string; version: number }>;
  stale: Array<{
    id: TId;
    sourceDocumentId: string;
    expectedVersion: number;
    currentVersion: number;
  }>;
  failed: Array<{ id: TId; code: string }>;
}

export interface RetrySourceDocumentResponseDto {
  status: "processing";
}

export interface QuickEntryResponseDto {
  sourceDocumentId: string;
  ledgerEntryId: string;
  status: "completed";
}

export interface CreatedRecordResult {
  sourceDocumentId: string;
  documentDate: string;
}

export type SaveSourceDocumentChangesInput = z.infer<typeof saveSourceDocumentChangesInputSchema>;

export interface SaveSourceDocumentChangesResultDto {
  updatedEntryIds: string[];
}

export type SplitSourceDocumentInput = z.infer<typeof splitSourceDocumentInputSchema>;

export type ApplyDateOrganizationInput = z.infer<
  typeof import("./contract-schemas").applyDateOrganizationInputSchema
>;
export type DismissDateOrganizationInput = z.infer<
  typeof import("./contract-schemas").dismissDateOrganizationInputSchema
>;

export interface ApplyDateOrganizationResultDto {
  sourceDocument: import("./document-contracts").SourceDocumentDetailDto;
  createdSourceDocumentIds: string[];
}

export interface SplitSourceDocumentResultDto {
  sourceDocument: import("./document-contracts").SourceDocumentDetailDto;
  splitSourceDocumentId: string;
  splitVersion: 1;
  movedEntryCount: number;
}

export interface BatchUpdateSourceDocumentsResultDto {
  sourceDocumentIds: string[];
  updatedCount: number;
}

export interface DeleteSourceDocumentResultDto {
  sourceDocumentId: string;
  deleted: boolean;
}

export interface CancelProcessingResponseDto {
  processingStatus: "cancelled";
}

export interface ListStreamPageInput {
  bookId?: string;
  startDate?: string | null | undefined;
  endDate?: string | null | undefined;
  minAmount?: string;
  maxAmount?: string;
  statuses?: string[];
  search?: string;
  cursor?: string | null | undefined;
  limit: number;
}

export interface GetStreamTotalInput {
  bookId?: string;
  startDate?: string | null;
  endDate?: string | null;
  minAmount?: string;
  maxAmount?: string;
  statuses?: readonly SourceDocumentProcessingStatus[];
  search?: string;
}

export interface CredentialSourceDocumentStatusResult {
  sourceDocumentId: string;
  revisionId: string;
  status: "processing" | "completed" | "invalid" | "failed" | "cancelled";
  submittedAt: string;
  finalizedAt: string | null;
  entryDate: string | null;
  result: null | {
    title: string | null;
    /**
     * Accounting total in the ledger's main currency (convertedAmount sum);
     * null while an entry has no exchange rate for its day.
     */
    total: string | null;
    /** Three-letter ISO currency code of `total`, from the ledger's main currency. */
    totalCurrency: string;
    entries: Array<{
      name: string;
      description: string | null;
      amount: string;
      currency: string | null;
      category: string | null;
    }>;
  };
  /**
   * Sanitized failure information. `code` is always a stable, non-empty
   * public code; `message` is an optional user-facing explanation.
   */
  error: null | { code: string; message?: string | null };
}
