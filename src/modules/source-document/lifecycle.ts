/** Pure lifecycle rules for source documents, shared by server and client code. */

export type RevisionProcessingStatus = "processing" | "completed" | "failed" | "cancelled";
export type RevisionFailureKind = "invalid_input" | "processing_error";

export type SupportedSourceDocumentAction =
  "retry" | "edit_retry" | "delete" | "cancel_processing" | "split_entries";

export function supportedSourceDocumentActions(input: {
  activeRevisionId: string | null;
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
