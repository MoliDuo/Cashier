import { logger } from "./logger";
import { AppError } from "./errors";
import { ValidationError } from "./errors";
import { toApplicationError } from "@/application/contracts/errors";

/**
 * Standard error response format
 */
export interface ErrorResponse {
  error: {
    message: string;
    code: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Convert any error to standard error response
 */
export function toErrorResponse(error: unknown): ErrorResponse {
  return toSanitizedErrorResponse(error);
}

/**
 * API boundaries use this projection. It has stable codes and intentionally does
 * not send adapter messages, paths, provider payloads, or error details to clients.
 */
export function toSanitizedErrorResponse(error: unknown): ErrorResponse {
  const applicationError = toApplicationError(error);
  const validationDetails =
    error instanceof ValidationError && Array.isArray(error.details?.issues)
      ? {
          issues: error.details.issues.map((issue) => {
            const candidate = issue as { code?: unknown; path?: unknown; message?: unknown };
            return {
              code: typeof candidate.code === "string" ? candidate.code : "custom",
              path: Array.isArray(candidate.path)
                ? candidate.path.filter(
                    (segment): segment is string | number =>
                      typeof segment === "string" || typeof segment === "number"
                  )
                : [],
              message: typeof candidate.message === "string" ? candidate.message : "Invalid value",
            };
          }),
        }
      : null;
  return {
    error: {
      message: applicationError.message,
      code: applicationError.code,
      ...(validationDetails != null
        ? { details: validationDetails }
        : applicationError.correlationId !== undefined
          ? { details: { correlationId: applicationError.correlationId } }
          : {}),
    },
  };
}

/**
 * Get HTTP status code from error
 */
export function getErrorStatusCode(error: unknown): number {
  if (error instanceof AppError) {
    return error.statusCode;
  }
  return 500;
}

/**
 * Log error with appropriate level
 */
export function logError(context: string, error: unknown): void {
  if (error instanceof AppError && error.statusCode < 500) {
    logger.warn({ error, context }, "Client error occurred");
  } else {
    logger.error({ error, context }, "Server error occurred");
  }
}
