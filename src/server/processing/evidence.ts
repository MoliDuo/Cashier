import "server-only";
import { AppError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { validateStoredImageBytes } from "@/lib/storage/image-processing";
import { storedFileAdapter } from "@/application/adapters/storage";

async function loadStoredFileForAI(ledgerId: string, storedFileId: string): Promise<string> {
  try {
    const read = await storedFileAdapter.readAuthorized(ledgerId, storedFileId);
    if (read == null) throw new ValidationError("Stored image is not available for this revision");
    await validateStoredImageBytes(Buffer.from(read.body), read.file.metadata.contentType);
    return `data:${read.file.metadata.contentType};base64,${Buffer.from(read.body).toString("base64")}`;
  } catch (error) {
    logger.error(
      {
        error,
        ledgerSubject: logIdentifier("ledger", ledgerId),
        storedFileSubject: logIdentifier("stored-file", storedFileId),
      },
      "Failed to load stored image evidence for AI"
    );
    throw new AppError("Failed to load stored image evidence", "IMAGE_LOAD_FAILED");
  }
}

/**
 * Result of loading an image for AI processing.
 * `success` is the discriminant so downstream filters can narrow correctly.
 */
export interface SuccessfulLoadImageResult {
  url: string;
  dataUrl: string;
  success: true;
}

export interface FailedLoadImageResult {
  url: string;
  error: Error;
  success: false;
}

export type LoadImageResult = SuccessfulLoadImageResult | FailedLoadImageResult;

export function isSuccessfulLoadImageResult(
  result: LoadImageResult
): result is SuccessfulLoadImageResult {
  return result.success;
}

export function isFailedLoadImageResult(result: LoadImageResult): result is FailedLoadImageResult {
  return !result.success;
}

export async function loadStoredFilesForAI(
  ledgerId: string,
  storedFileIds: string[]
): Promise<LoadImageResult[]> {
  return Promise.all(
    storedFileIds.map(async (storedFileId) => {
      try {
        return {
          url: storedFileId,
          dataUrl: await loadStoredFileForAI(ledgerId, storedFileId),
          success: true as const,
        };
      } catch (error) {
        return {
          url: storedFileId,
          error: error instanceof Error ? error : new Error(String(error)),
          success: false as const,
        };
      }
    })
  );
}
