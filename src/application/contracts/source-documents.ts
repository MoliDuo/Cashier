/**
 * Application contracts shared by the retained workflows. These types deliberately
 * describe business values only; persistence and provider details stay in adapters.
 */

import type { ApplicationErrorCode } from "./errors";

export type { ApplicationErrorCode } from "./errors";

export type SourceDocumentId = string;
export type RevisionId = string;
export type LedgerId = string;
export type StoredFileId = string;
export type UploadSessionId = string;
export type ProcessingJobId = string;

export type RevisionProcessingStatus = "processing" | "completed" | "failed" | "cancelled";
export type RevisionOrigin = "submission" | "manual_edit" | "manual_entry";
export type RevisionFailureKind = "invalid_input" | "processing_error";

export type SupportedSourceDocumentAction =
  "retry" | "edit_retry" | "delete" | "cancel_processing" | "split_entries";

export interface SourceDocumentContract {
  id: SourceDocumentId;
  ledgerId: LedgerId;
  version: number;
  activeRevisionId: RevisionId | null;
  latestSubmissionRevisionId: RevisionId | null;
  supportedActions: readonly SupportedSourceDocumentAction[];
}

export interface SourceDocumentRevisionContract {
  id: RevisionId;
  sourceDocumentId: SourceDocumentId;
  origin: RevisionOrigin;
  processingStatus: RevisionProcessingStatus | null;
  submittedAt: string;
  finishedAt: string | null;
}

export function supportedSourceDocumentActions(input: {
  activeRevisionId: RevisionId | null;
  latestSubmissionStatus: RevisionProcessingStatus | null;
  hasSubmissionInput: boolean;
  deleted?: boolean;
}): readonly SupportedSourceDocumentAction[] {
  if (input.deleted) {
    return [];
  }

  if (input.latestSubmissionStatus === "processing") {
    return ["cancel_processing", "retry", "edit_retry", "delete"];
  }

  const retryActions: SupportedSourceDocumentAction[] = input.hasSubmissionInput
    ? ["retry", "edit_retry"]
    : [];
  if (input.activeRevisionId != null) {
    return ["split_entries", ...retryActions, "delete"];
  }
  return [...retryActions, "delete"];
}

export interface ProcessingJobContract {
  id: ProcessingJobId;
  sourceDocumentId: SourceDocumentId;
  revisionId: RevisionId;
  requestedAt: string;
  attemptNumber: number;
}

/**
 * Claim identity for a leased processing worker. Writes that finalize a
 * revision or projection must verify this lease inside their transaction so a
 * worker whose lease was lost or reclaimed cannot commit stale results.
 */
export interface ProcessingLeaseContract {
  jobId: ProcessingJobId;
  claimToken: string;
}

interface ProcessingDiagnostic {
  correlationId: string;
  code: ApplicationErrorCode;
  stableCode?: ProcessingFailureCode;
}

export interface ProcessingCompletionContract {
  jobId: ProcessingJobId;
  claimToken: string;
  processingStatus: Extract<RevisionProcessingStatus, "completed" | "failed">;
  diagnostic?: ProcessingDiagnostic;
}

export interface ProcessingClaimContract {
  ledgerId: LedgerId;
  job: ProcessingJobContract;
  claimToken: string;
  expiresAt: string;
}

/**
 * Stable, user-facing processing failure codes for documents that failed to parse.
 * These are localized and sanitized before being shown in the UI.
 */
export const PROCESSING_FAILURE_CODES = [
  "ai_provider_unavailable",
  "ai_schema_invalid",
  "exchange_rate_failure",
  "storage_failure",
  "processing_unavailable",
  "database_unavailable",
  "request_bound_retry_exhausted",
  "processing_timeout",
] as const;
export type ProcessingFailureCode = (typeof PROCESSING_FAILURE_CODES)[number];

/**
 * Map a legacy or unknown failure code to a stable ProcessingFailureCode.
 * Unknown values are mapped to "processing_unavailable" without discarding
 * the original stored value in the database.
 */
export function toStableFailureCode(legacyCode: string | null | undefined): ProcessingFailureCode {
  if (legacyCode == null) return "processing_unavailable";

  // Direct matches for known stable codes
  if ((PROCESSING_FAILURE_CODES as readonly string[]).includes(legacyCode)) {
    return legacyCode as ProcessingFailureCode;
  }

  // Map legacy ApplicationErrorCode values to stable codes
  switch (legacyCode) {
    case "INTERNAL":
    case "VALIDATION_FAILED":
      return "ai_schema_invalid";
    case "RATE_LIMITED":
      return "ai_provider_unavailable";
    case "STORAGE_UNAVAILABLE":
      return "storage_failure";
    case "NOT_FOUND":
    case "CONFLICT":
      return "database_unavailable";
    default:
      return "processing_unavailable";
  }
}

export interface SourceDocumentSubmissionContract {
  sourceDocumentId: SourceDocumentId;
  revisionId: RevisionId;
  processingStatus: "processing";
}

export function toSourceDocumentSubmissionContract(
  sourceDocument: Pick<SourceDocumentContract, "id">,
  revision: Pick<SourceDocumentRevisionContract, "id" | "processingStatus">
): SourceDocumentSubmissionContract {
  return {
    sourceDocumentId: sourceDocument.id,
    revisionId: revision.id,
    processingStatus: "processing",
  };
}

export interface SourceDocumentPort {
  get(ledgerId: LedgerId, id: SourceDocumentId): Promise<SourceDocumentContract | null>;
  recordProcessingFailure(input: {
    ledgerId: LedgerId;
    sourceDocumentId: SourceDocumentId;
    revisionId: RevisionId;
    failureKind: RevisionFailureKind;
    /**
     * User-facing text. `null` when the failure carries no explanation, in
     * which case the UI falls back to localized copy.
     */
    failureMessage: string | null;
    failureCode?: string | null;
    lease?: ProcessingLeaseContract;
  }): Promise<boolean>;
}

export interface SourceDocumentSubmissionResult {
  document: SourceDocumentContract;
  revision: SourceDocumentRevisionContract;
  job: ProcessingJobContract;
  /** True when the result was replayed from an already-completed idempotent request. */
  idempotencyReplay?: boolean;
}

/** Atomically persists submitted evidence and the durable work needed to process it. */
export type SourceDocumentSubmissionInput = {
  ledgerId: LedgerId;
  expectedVersion?: number;
  input?: SourceDocumentInputContract;
  inheritInput?: boolean;
  supersedeProcessing?: boolean;
} & (
  | { sourceDocumentId: SourceDocumentId; bookId?: string }
  | { sourceDocumentId?: never; bookId: string }
);

export interface SourceDocumentInputContract {
  text: string | null;
  storedFileIds: readonly StoredFileId[];
  documentDate: string | null;
  dateReference?: string | null;
}

export interface SourceDocumentIdempotencyInput {
  principalType: "credential" | "user";
  principalId: string;
  key: string;
  contentFingerprint: string | null;
}

export interface SourceDocumentSubmissionPort {
  submit(input: SourceDocumentSubmissionInput): Promise<SourceDocumentSubmissionResult>;
  submitIdempotently(
    idempotency: SourceDocumentIdempotencyInput,
    prepare: () => Promise<SourceDocumentSubmissionInput>
  ): Promise<SourceDocumentSubmissionResult>;
}
