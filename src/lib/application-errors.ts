import { AppError } from "@/lib/errors";

export type ApplicationErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "UPLOAD_QUOTA_EXCEEDED"
  | "STATS_RANGE_TOO_LARGE"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "STORAGE_UNAVAILABLE"
  | "INTERNAL";

export interface ApplicationErrorContract {
  code: ApplicationErrorCode;
  message: string;
  correlationId?: string;
}

const APPLICATION_CODE_BY_APP_CODE: Readonly<Record<string, ApplicationErrorCode>> = {
  VALIDATION_ERROR: "VALIDATION_FAILED",
  UNAUTHORIZED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  UPLOAD_QUOTA_EXCEEDED: "UPLOAD_QUOTA_EXCEEDED",
  STATS_RANGE_TOO_LARGE: "STATS_RANGE_TOO_LARGE",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  RATE_LIMIT: "RATE_LIMITED",
  S3_UPLOAD_FAILED: "STORAGE_UNAVAILABLE",
  S3_DOWNLOAD_FAILED: "STORAGE_UNAVAILABLE",
  S3_DELETE_FAILED: "STORAGE_UNAVAILABLE",
  FILE_NOT_FOUND: "NOT_FOUND",
};

const HIDDEN_MESSAGE = "The request could not be completed.";

function hidden(code: ApplicationErrorCode): ApplicationErrorContract {
  return { code, message: HIDDEN_MESSAGE, correlationId: crypto.randomUUID() };
}

/**
 * Only application errors with a known code keep their message; everything
 * else reaches the client as a code and a correlation id for the logs.
 */
export function toApplicationError(error: unknown): ApplicationErrorContract {
  if (!(error instanceof AppError)) return hidden("INTERNAL");
  const code = APPLICATION_CODE_BY_APP_CODE[error.code] ?? "INTERNAL";
  if (code === "INTERNAL" || code === "STORAGE_UNAVAILABLE") return hidden(code);
  return { code, message: error.message };
}
