import { ValidationError } from "@/lib/errors";

/**
 * Shared Web Upload Policy
 *
 * Central, provider-neutral policy constants and validators for Web source-document
 * uploads. Every upload layer — client preflight, server validation, Sharp processing,
 * and stored-file finalization — applies the same rules from this module.
 *
 * These defaults apply to the Web submission flow only. The API v1 flow
 * has its own separate limits and is not covered by this module.
 *
 * KNOWN GAP (escalation condition — not fixed in Task 6):
 * The Web submission path (createSourceDocumentAction) accepts pre-finalized
 * storedFileIds without re-validating them against the current upload policy.
 * A stored file that passed policy checks at finalization time could later
 * exceed policy limits if the policy is tightened. Closing this gap requires
 * a policy version stamp on stored files or a re-validation step at revision
 * creation time. See Issue 2 in the Task 6 review.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of files per upload revision. */
export const MAX_FILES = 4;

/** Maximum original (raw uploaded) bytes per individual file. */
export const MAX_ORIGINAL_BYTES_PER_FILE = 3 * 1024 * 1024; // 3 MB

/** Maximum normalized (post-processing) bytes per individual file. */
export const MAX_NORMALIZED_BYTES_PER_FILE = 4 * 1024 * 1024; // 4 MB

/** Maximum total normalized bytes across all files in a single revision. */
export const MAX_NORMALIZED_BYTES_PER_REVISION = 3 * 1024 * 1024; // 3 MB

/** Maximum megapixels per image file (width * height / 1_000_000). */
export const MAX_MEGAPIXELS_PER_FILE = 16;

/** Maximum characters in a text-only source-document submission. */
export const MAX_TEXT_CHARACTERS = 20000;

/** Upload session expiry in milliseconds. */
export const UPLOAD_SESSION_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
export const DIRECT_UPLOAD_FINALIZE_BUFFER_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Explicitly supported MIME types for Web uploads.
 *
 * HEIC/HEIF are omitted because sharp cannot decode them deterministically
 * across all inputs — encoding variants and exif orientation frequently cause
 * decode failures or silent data corruption. Users must convert to JPEG/PNG
 * before upload.
 */
export const SUPPORTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

/** Set form of SUPPORTED_MIME_TYPES for fast lookups. */
export const SUPPORTED_MIME_SET: ReadonlySet<string> = new Set(SUPPORTED_MIME_TYPES);

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * Validate a file upload request against basic policy limits.
 * Throws an Error with a descriptive message if the request violates any constraint.
 */
export function validateFileUpload(file: { contentType: string; byteSize: number }): void {
  if (!SUPPORTED_MIME_SET.has(file.contentType)) {
    throw new ValidationError(`Unsupported content type: ${file.contentType}`);
  }
  if (!Number.isInteger(file.byteSize) || file.byteSize <= 0) {
    throw new ValidationError(`Invalid byte size: ${file.byteSize}`);
  }
  if (file.byteSize > MAX_ORIGINAL_BYTES_PER_FILE) {
    throw new ValidationError(
      `File exceeds maximum original size of ${MAX_ORIGINAL_BYTES_PER_FILE} bytes`
    );
  }
}

/**
 * Validate image processing metadata (pixel dimensions and format).
 * Throws if the image exceeds the megapixel limit or uses an unsupported format.
 */
export function validateImageProcessing(metadata: {
  width: number;
  height: number;
  format: string;
}): void {
  const megapixels = (metadata.width * metadata.height) / 1_000_000;
  if (megapixels > MAX_MEGAPIXELS_PER_FILE) {
    throw new ValidationError(
      `Image dimensions ${metadata.width}x${metadata.height} (${megapixels.toFixed(1)} MP) ` +
        `exceed maximum of ${MAX_MEGAPIXELS_PER_FILE} MP`
    );
  }
  const mimeType = formatToMimeType(metadata.format);
  if (!SUPPORTED_MIME_SET.has(mimeType)) {
    throw new ValidationError(`Unsupported image format: ${metadata.format}`);
  }
}

/**
 * Validate total normalized bytes against the per-revision aggregate limit.
 * Called during finalization and revision processing.
 *
 * @param aggregateNormalizedBytes - Sum of all previously finalized normalized bytes
 *                                   across all files in the revision.
 * @param newFileBytes - Normalized size of the file being added.
 */
export function validateRevisionUpload(
  aggregateNormalizedBytes: number,
  newFileBytes: number
): void {
  const total = aggregateNormalizedBytes + newFileBytes;
  if (total > MAX_NORMALIZED_BYTES_PER_REVISION) {
    throw new ValidationError(
      `Total normalized bytes ${total} exceeds revision limit of ` +
        `${MAX_NORMALIZED_BYTES_PER_REVISION}`
    );
  }
}

/**
 * Check whether a file count is within policy bounds.
 */
export function validateFileCount(count: number): void {
  if (count < 1 || count > MAX_FILES) {
    throw new ValidationError(`File count ${count} must be between 1 and ${MAX_FILES}`);
  }
}

/**
 * Validate that the combined total of stored-file IDs, inline images,
 * and original images does not exceed the per-revision file limit.
 *
 * Called at schema, server-function, and transaction layers for defense in depth.
 */
export function validateAggregateFileCount(
  storedFileIdsCount: number,
  imageCount: number,
  originalImageCount: number = 0
): void {
  const total = storedFileIdsCount + imageCount + originalImageCount;
  if (total > MAX_FILES) {
    throw new ValidationError(`Total file count ${total} exceeds maximum of ${MAX_FILES} files`);
  }
}

/**
 * Sanitize and resolve the trusted MIME type.
 *
 * Trusts the detected type (from content inspection, e.g. sharp metadata) over
 * the declared type (from client headers). Throws if neither value is supported.
 *
 * @param declared - MIME type declared by the client (headers / form field).
 * @param detected - MIME type detected from actual content inspection, or null
 *                   if no detection was possible.
 * @returns The canonical supported MIME type.
 */
export function sanitizeMimeType(declared: string, detected: string | null): string {
  const detectedClean = detected?.toLowerCase() ?? "";
  const declaredClean = declared.toLowerCase();

  if (detectedClean !== "" && SUPPORTED_MIME_SET.has(detectedClean)) {
    return detectedClean;
  }

  if (SUPPORTED_MIME_SET.has(declaredClean)) {
    return declaredClean;
  }

  throw new ValidationError(
    `Unsupported MIME type: declared="${declaredClean}", detected="${detectedClean}"`
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a format identifier (e.g. "jpeg", "png") to its MIME type string.
 */
function formatToMimeType(format: string): string {
  const map: Record<string, string> = {
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    avif: "image/avif",
  };
  return map[format.toLowerCase()] ?? `image/${format.toLowerCase()}`;
}
