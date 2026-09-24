import "server-only";
import crypto from "node:crypto";
import type { StoredFileContract, UploadFileRequestContract } from "./types";
import { ValidationError } from "@/lib/errors";
import {
  MAX_FILES,
  MAX_ORIGINAL_BYTES_PER_FILE,
  SUPPORTED_MIME_SET,
} from "@/lib/storage/upload-policy";
import { storedFiles } from "@/persistence";

export function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function checksum(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function safeTokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(tokenHash(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function mapStoredFile(row: typeof storedFiles.$inferSelect): StoredFileContract {
  return {
    id: row.id,
    metadata: {
      contentType: row.contentType,
      byteSize: row.byteSize,
      originalFilename: row.originalFilename,
      checksum: row.checksum,
    },
    createdAt: row.createdAt.toISOString(),
  };
}

export function validateRequests(files: readonly UploadFileRequestContract[]): void {
  if (files.length === 0 || files.length > MAX_FILES) {
    throw new ValidationError(`Upload plans require 1-${MAX_FILES} files`);
  }
  for (const file of files) {
    if (!SUPPORTED_MIME_SET.has(file.contentType)) {
      throw new ValidationError("Unsupported upload content type");
    }
    if (
      !Number.isInteger(file.byteSize) ||
      file.byteSize <= 0 ||
      file.byteSize > MAX_ORIGINAL_BYTES_PER_FILE
    ) {
      throw new ValidationError("Upload file size exceeds the configured limit");
    }
    if ((file.originalFilename?.length ?? 0) > 255) {
      throw new ValidationError("Upload filename is too long");
    }
    if (file.checksum != null && !/^[a-f\d]{64}$/i.test(file.checksum)) {
      throw new ValidationError("Upload checksum must be a SHA-256 hex digest");
    }
  }
}

export function temporaryKey(ledgerId: string, sessionId: string, targetId: string): string {
  return `temporary/${ledgerId}/${sessionId}/${targetId}`;
}

export function durableKey(ledgerId: string, storedFileId: string): string {
  return `${ledgerId}/stored/${storedFileId}`;
}
