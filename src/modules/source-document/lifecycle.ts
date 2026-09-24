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
  "request_bound_retry_exhausted",
  "processing_timeout",
] as const;
export type ProcessingFailureCode = (typeof PROCESSING_FAILURE_CODES)[number];

/**
 * The public code for a stored processing failure. Anything outside the stable
 * set, including a missing code, is reported as "processing_unavailable".
 */
export function toStableFailureCode(code: string | null | undefined): ProcessingFailureCode {
  return (PROCESSING_FAILURE_CODES as readonly string[]).includes(code ?? "")
    ? (code as ProcessingFailureCode)
    : "processing_unavailable";
}
