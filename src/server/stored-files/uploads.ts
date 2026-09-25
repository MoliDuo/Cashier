import "server-only";
import crypto from "node:crypto";
import { and, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import type {
  DirectUploadPlanContract,
  StoredFileContract,
  UploadFileRequestContract,
} from "./types";
import { db } from "@/lib/db";
import { lockLedgerForUpdate } from "@/lib/db/transaction-locks";
import { getS3Storage } from "@/lib/storage/s3";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { processImage } from "@/lib/storage/image-processing";
import { UPLOAD_DAILY_BYTES_LIMIT, UPLOAD_PENDING_FILE_LIMIT } from "@/config/tuning";
import {
  DIRECT_UPLOAD_FINALIZE_BUFFER_MS,
  MAX_FILES,
  MAX_NORMALIZED_BYTES_PER_REVISION,
  MAX_ORIGINAL_BYTES_PER_FILE,
  UPLOAD_PLAN_EXPIRY_MS,
} from "@/lib/storage/upload-policy";
import { sourceDocumentFiles, storedFiles } from "@/persistence";
import { checksum, durableKey, mapStoredFile, temporaryKey, validateRequests } from "./shared";

interface PendingFile {
  id: string;
  contentType: string;
  byteSize: number;
  originalFilename: string | null;
  checksum: string | null;
}

/**
 * Records files as pending under the ledger lock, once they fit the ledger's
 * quota: a bounded number waiting for finalization, and a daily byte budget
 * that counts every file stored since UTC midnight.
 */
async function reservePendingFiles(
  ledgerId: string,
  files: readonly PendingFile[],
  now: Date
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx, ledgerId);
    const utcDayStart = new Date(now);
    utcDayStart.setUTCHours(0, 0, 0, 0);
    const [usage] = await tx
      .select({
        pending: sql<number>`count(*) FILTER (WHERE ${storedFiles.finalizedAt} IS NULL)::int`,
        bytesToday: sql<number>`coalesce(sum(${storedFiles.byteSize}) FILTER (WHERE ${storedFiles.createdAt} >= ${utcDayStart}), 0)::bigint`,
      })
      .from(storedFiles)
      .where(eq(storedFiles.ledgerId, ledgerId));
    const reservedBytes = files.reduce((sum, file) => sum + file.byteSize, 0);
    if (
      (usage?.pending ?? 0) + files.length > UPLOAD_PENDING_FILE_LIMIT ||
      Number(usage?.bytesToday ?? 0) + reservedBytes > UPLOAD_DAILY_BYTES_LIMIT
    ) {
      throw new AppError("Upload quota exceeded", "UPLOAD_QUOTA_EXCEEDED", 429);
    }
    await tx.insert(storedFiles).values(
      files.map((file) => ({
        id: file.id,
        ledgerId,
        storageKey: durableKey(ledgerId, file.id),
        contentType: file.contentType,
        byteSize: file.byteSize,
        originalFilename: file.originalFilename,
        checksum: file.checksum,
        createdAt: now,
      }))
    );
  });
}

/**
 * Deletes the given files that no document uses, with their objects. Rows go
 * first, so a file a document took in the meantime keeps both. Best effort:
 * whatever is left is swept by the daily cron.
 */
export async function discardUnusedFiles(
  ledgerId: string,
  storedFileIds: readonly string[]
): Promise<void> {
  if (storedFileIds.length === 0) return;
  try {
    const deleted = await db
      .delete(storedFiles)
      .where(
        and(
          eq(storedFiles.ledgerId, ledgerId),
          inArray(storedFiles.id, [...storedFileIds]),
          notExists(
            db
              .select({ id: sourceDocumentFiles.id })
              .from(sourceDocumentFiles)
              .where(
                and(
                  eq(sourceDocumentFiles.ledgerId, storedFiles.ledgerId),
                  eq(sourceDocumentFiles.storedFileId, storedFiles.id)
                )
              )
          )
        )
      )
      .returning({ id: storedFiles.id, storageKey: storedFiles.storageKey });
    const storage = getS3Storage();
    await Promise.all(
      deleted.flatMap((file) => [
        storage.delete(file.storageKey),
        storage.delete(temporaryKey(ledgerId, file.id)),
      ])
    );
  } catch {
    logger.warn(
      { ledgerSubject: logIdentifier("ledger", ledgerId) },
      "Discarding unused stored files was incomplete"
    );
  }
}

/**
 * Plans a browser upload: one pending file per request, each with a presigned
 * URL for its temporary object. The declared size, type and checksum are held
 * on the pending row until finalization checks the bytes against them.
 */
export async function planDirectUpload(
  ledgerId: string,
  files: readonly UploadFileRequestContract[]
): Promise<DirectUploadPlanContract> {
  validateRequests(files);
  if (files.some((file) => file.checksum == null || !/^[a-f\d]{64}$/.test(file.checksum))) {
    throw new ValidationError("Direct uploads require a lowercase SHA-256 checksum");
  }
  if (files.reduce((total, file) => total + file.byteSize, 0) > MAX_NORMALIZED_BYTES_PER_REVISION) {
    throw new ValidationError("Direct upload batch exceeds the configured total byte limit");
  }

  const now = new Date();
  const pending = files.map((file) => ({
    id: crypto.randomUUID(),
    contentType: file.contentType,
    byteSize: file.byteSize,
    originalFilename: file.originalFilename,
    checksum: file.checksum!,
  }));
  await reservePendingFiles(ledgerId, pending, now);
  try {
    const targets = await Promise.all(
      pending.map(async (file) => ({
        id: file.id,
        ...(await getS3Storage().presignUpload(
          temporaryKey(ledgerId, file.id),
          file.contentType,
          file.checksum,
          Math.floor((UPLOAD_PLAN_EXPIRY_MS - DIRECT_UPLOAD_FINALIZE_BUFFER_MS) / 1000)
        )),
      }))
    );
    return {
      expiresAt: new Date(now.getTime() + UPLOAD_PLAN_EXPIRY_MS).toISOString(),
      targets,
      maxFiles: MAX_FILES,
      maxBytesPerFile: MAX_ORIGINAL_BYTES_PER_FILE,
    };
  } catch (error) {
    await discardUnusedFiles(
      ledgerId,
      pending.map((file) => file.id)
    );
    throw error;
  }
}

/**
 * Inspects, normalizes and stores the objects a browser uploaded, then marks
 * their files ready. Finalizing files that are already ready returns them
 * unchanged, so a retried request is harmless.
 */
export async function finalizeDirectUpload(input: {
  ledgerId: string;
  storedFileIds: readonly string[];
}): Promise<readonly StoredFileContract[]> {
  const { ledgerId, storedFileIds } = input;
  if (storedFileIds.length === 0 || new Set(storedFileIds).size !== storedFileIds.length) {
    throw new ValidationError("Finalization requires unique stored files");
  }
  const rows = await db
    .select()
    .from(storedFiles)
    .where(and(eq(storedFiles.ledgerId, ledgerId), inArray(storedFiles.id, [...storedFileIds])));
  if (rows.length !== storedFileIds.length) throw new NotFoundError("Stored file");
  const now = new Date();
  const pending = rows.filter((row) => row.finalizedAt == null);
  if (pending.some((row) => row.createdAt.getTime() + UPLOAD_PLAN_EXPIRY_MS <= now.getTime())) {
    throw new ConflictError("Upload plan has expired");
  }

  if (pending.length > 0) {
    const storage = getS3Storage();
    let normalized: { bytes: Buffer; contentType: string; checksum: string }[];
    try {
      const uploaded = await Promise.all(
        pending.map(async (row) => {
          const { metadata, bytes } = await storage.readObject(temporaryKey(ledgerId, row.id));
          if (
            metadata.byteSize !== row.byteSize ||
            bytes.length !== row.byteSize ||
            metadata.contentType !== row.contentType ||
            checksum(bytes) !== row.checksum
          ) {
            throw new ConflictError("Uploaded object does not match the upload plan");
          }
          return bytes;
        })
      );
      normalized = await Promise.all(
        uploaded.map(async (bytes, position) => {
          const processed = await processImage(bytes, pending[position]!.contentType);
          return {
            bytes: processed.buffer,
            contentType: processed.mimeType,
            checksum: checksum(processed.buffer),
          };
        })
      );
    } catch (error) {
      // Bytes that break the plan never become usable; bytes still on their
      // way leave the files pending for another try.
      if (error instanceof ConflictError) {
        await discardUnusedFiles(
          ledgerId,
          pending.map((row) => row.id)
        );
      }
      throw error;
    }
    const readyBytes = rows
      .filter((row) => row.finalizedAt != null)
      .reduce((sum, row) => sum + row.byteSize, 0);
    const totalBytes = normalized.reduce((sum, file) => sum + file.bytes.length, readyBytes);
    if (totalBytes > MAX_NORMALIZED_BYTES_PER_REVISION) {
      throw new ValidationError(
        `Total stored bytes ${totalBytes} exceeds revision limit of ${MAX_NORMALIZED_BYTES_PER_REVISION}`
      );
    }

    await Promise.all(
      pending.map(async (row, position) => {
        const file = normalized[position]!;
        await storage.upload(row.storageKey, file.bytes, file.contentType);
        // A concurrent finalization of the same file wrote the same bytes, so
        // whichever update lands first is the one that counts.
        await db
          .update(storedFiles)
          .set({
            contentType: file.contentType,
            byteSize: file.bytes.length,
            checksum: file.checksum,
            finalizedAt: now,
          })
          .where(
            and(
              eq(storedFiles.ledgerId, ledgerId),
              eq(storedFiles.id, row.id),
              isNull(storedFiles.finalizedAt)
            )
          );
      })
    );
    await Promise.all(pending.map((row) => storage.delete(temporaryKey(ledgerId, row.id))));
  }

  const ready = await db
    .select()
    .from(storedFiles)
    .where(and(eq(storedFiles.ledgerId, ledgerId), inArray(storedFiles.id, [...storedFileIds])));
  const byId = new Map(ready.map((row) => [row.id, row]));
  return storedFileIds.map((id) => mapStoredFile(byId.get(id)!));
}

/**
 * Stores images the server already holds and normalized, such as an API
 * request's inline images: pending rows first, for the quota, then the
 * objects, then the rows are marked ready. Returns ids in input order.
 */
export async function storeProcessedImages(
  ledgerId: string,
  images: readonly { bytes: Buffer; contentType: string }[]
): Promise<string[]> {
  const files = images.map((image) => ({
    id: crypto.randomUUID(),
    contentType: image.contentType,
    byteSize: image.bytes.length,
    originalFilename: null,
    checksum: checksum(image.bytes),
    bytes: image.bytes,
  }));
  validateRequests(files);
  const totalBytes = files.reduce((sum, file) => sum + file.byteSize, 0);
  if (totalBytes > MAX_NORMALIZED_BYTES_PER_REVISION) {
    throw new ValidationError(
      `Total stored bytes ${totalBytes} exceeds revision limit of ${MAX_NORMALIZED_BYTES_PER_REVISION}`
    );
  }
  await reservePendingFiles(ledgerId, files, new Date());
  const ids = files.map((file) => file.id);
  try {
    const storage = getS3Storage();
    await Promise.all(
      files.map((file) =>
        storage.upload(durableKey(ledgerId, file.id), file.bytes, file.contentType)
      )
    );
    await db
      .update(storedFiles)
      .set({ finalizedAt: new Date() })
      .where(
        and(
          eq(storedFiles.ledgerId, ledgerId),
          inArray(storedFiles.id, ids),
          isNull(storedFiles.finalizedAt)
        )
      );
  } catch (error) {
    await discardUnusedFiles(ledgerId, ids);
    throw error;
  }
  return ids;
}
