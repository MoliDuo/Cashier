import "server-only";
import crypto from "node:crypto";
import { and, eq, inArray, notExists } from "drizzle-orm";
import type { StoredFileContract } from "./types";
import { db } from "@/lib/db";
import { getS3Storage } from "@/lib/storage/s3";
import { AppError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { processImage } from "@/lib/storage/image-processing";
import {
  MAX_FILES,
  MAX_NORMALIZED_BYTES_PER_ATTEMPT,
  MAX_ORIGINAL_BYTES_PER_FILE,
  SUPPORTED_MIME_SET,
} from "@/lib/storage/upload-policy";
import { sourceDocumentFiles, storedFiles } from "@/persistence";
import { checksum, durableKey, mapStoredFile } from "./shared";

interface NewFile {
  id: string;
  contentType: string;
  byteSize: number;
  originalFilename: string | null;
  checksum: string;
  bytes: Buffer;
}

/**
 * Records the files, then writes their objects. The row comes first so that an object never exists
 * without one a sweep can find; a failure after it removes the rows again. Files are recorded as
 * ready, since their bytes are already normalized.
 */
async function storeFiles(files: readonly NewFile[]): Promise<(typeof storedFiles.$inferSelect)[]> {
  const now = new Date();
  const rows = await db
    .insert(storedFiles)
    .values(
      files.map((file) => ({
        id: file.id,
        storageKey: durableKey(file.id),
        contentType: file.contentType,
        byteSize: file.byteSize,
        originalFilename: file.originalFilename,
        checksum: file.checksum,
        createdAt: now,
      }))
    )
    .returning();
  const ids = files.map((file) => file.id);
  try {
    const storage = getS3Storage();
    await Promise.all(
      files.map((file) => storage.upload(durableKey(file.id), file.bytes, file.contentType))
    );
  } catch (error) {
    await discardUnusedFiles(ids);
    throw error;
  }
  return rows;
}

/**
 * Deletes the given files that no document uses, with their objects. Rows go
 * first, so a file a document took in the meantime keeps both. Best effort:
 * whatever is left is swept by the daily cron.
 */
export async function discardUnusedFiles(storedFileIds: readonly string[]): Promise<void> {
  if (storedFileIds.length === 0) return;
  try {
    const deleted = await db
      .delete(storedFiles)
      .where(
        and(
          inArray(storedFiles.id, [...storedFileIds]),
          notExists(
            db
              .select({ id: sourceDocumentFiles.id })
              .from(sourceDocumentFiles)
              .where(eq(sourceDocumentFiles.storedFileId, storedFiles.id))
          )
        )
      )
      .returning({ id: storedFiles.id, storageKey: storedFiles.storageKey });
    const storage = getS3Storage();
    await Promise.all(deleted.map((file) => storage.delete(file.storageKey)));
  } catch {
    logger.warn({ count: storedFileIds.length }, "Discarding unused stored files was incomplete");
  }
}

/**
 * Normalizes one uploaded image and stores it as a ready file. The declared type only has to be a
 * supported one: Sharp decides what the bytes are, and the stored file carries what Sharp wrote.
 * The attempt's total is checked again when a document takes the files.
 */
export async function storeUploadedImage(input: {
  bytes: Buffer;
  contentType: string;
  originalFilename: string | null;
}): Promise<StoredFileContract> {
  if (!SUPPORTED_MIME_SET.has(input.contentType)) {
    throw new ValidationError("Unsupported upload content type");
  }
  if (input.bytes.length === 0 || input.bytes.length > MAX_ORIGINAL_BYTES_PER_FILE) {
    throw new ValidationError("Upload file size exceeds the configured limit");
  }
  if ((input.originalFilename?.length ?? 0) > 255) {
    throw new ValidationError("Upload filename is too long");
  }
  const processed = await processImage(input.bytes, input.contentType).catch((error: unknown) => {
    // Bytes Sharp cannot read are the uploader's mistake, not a fault here.
    throw error instanceof AppError
      ? error
      : new ValidationError("The file is not a readable image");
  });
  if (processed.buffer.length > MAX_NORMALIZED_BYTES_PER_ATTEMPT) {
    throw new ValidationError(
      `Stored image is ${processed.buffer.length} bytes, over the attempt limit of ${MAX_NORMALIZED_BYTES_PER_ATTEMPT}`
    );
  }
  const file: NewFile = {
    id: crypto.randomUUID(),
    contentType: processed.mimeType,
    byteSize: processed.buffer.length,
    originalFilename: input.originalFilename,
    checksum: checksum(processed.buffer),
    bytes: processed.buffer,
  };
  const [row] = await storeFiles([file]);
  return mapStoredFile(row!);
}

/**
 * Stores images the server already holds and normalized, such as an API
 * request's inline images. Returns ids in input order.
 */
export async function storeProcessedImages(
  images: readonly { bytes: Buffer; contentType: string }[]
): Promise<string[]> {
  if (images.length === 0 || images.length > MAX_FILES) {
    throw new ValidationError(`Uploads require 1-${MAX_FILES} files`);
  }
  const files: NewFile[] = images.map((image) => ({
    id: crypto.randomUUID(),
    contentType: image.contentType,
    byteSize: image.bytes.length,
    originalFilename: null,
    checksum: checksum(image.bytes),
    bytes: image.bytes,
  }));
  const totalBytes = files.reduce((sum, file) => sum + file.byteSize, 0);
  if (totalBytes > MAX_NORMALIZED_BYTES_PER_ATTEMPT) {
    throw new ValidationError(
      `Total stored bytes ${totalBytes} exceeds attempt limit of ${MAX_NORMALIZED_BYTES_PER_ATTEMPT}`
    );
  }
  await storeFiles(files);
  return files.map((file) => file.id);
}
