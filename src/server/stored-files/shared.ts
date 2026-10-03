import "server-only";
import crypto from "node:crypto";
import type { StoredFileContract } from "./types";
import { storedFiles } from "@/persistence";

export function checksum(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
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

/** Where the browser puts a pending file's bytes before finalization reads them. */
export function temporaryKey(storedFileId: string): string {
  return `temporary/${storedFileId}`;
}

/** Where a ready file's bytes live. */
export function durableKey(storedFileId: string): string {
  return `stored/${storedFileId}`;
}
