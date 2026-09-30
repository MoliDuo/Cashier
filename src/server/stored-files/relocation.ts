import "server-only";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getS3Storage } from "@/lib/storage/s3";
import { storedFiles } from "@/persistence";
import { durableKey } from "./shared";

/*
 * Files stored before the ledger id was retired sit under older key layouts,
 * such as `<ledger id>/stored/<id>`. Every read goes through the row's
 * `storage_key`, so they still resolve; moving them to `stored/<id>` lets the
 * orphan sweep look at `stored/` alone.
 */

export interface FileToRelocate {
  id: string;
  storageKey: string;
  contentType: string;
  byteSize: number;
}

/** Ready files whose bytes are not at `stored/<id>`, oldest first. */
export async function findFilesToRelocate(): Promise<FileToRelocate[]> {
  return db
    .select({
      id: storedFiles.id,
      storageKey: storedFiles.storageKey,
      contentType: storedFiles.contentType,
      byteSize: storedFiles.byteSize,
    })
    .from(storedFiles)
    .where(
      and(
        isNotNull(storedFiles.finalizedAt),
        sql`${storedFiles.storageKey} <> 'stored/' || ${storedFiles.id}::text`
      )
    )
    .orderBy(asc(storedFiles.createdAt), asc(storedFiles.id));
}

/**
 * - `moved`: the row names `stored/<id>` and the old object is deleted.
 * - `moved_old_kept`: the row moved, but deleting the old object failed.
 * - `row_changed`: the row was deleted or rekeyed meanwhile, so the copy is
 *   an orphan the daily sweep removes.
 */
export type RelocationOutcome = "moved" | "moved_old_kept" | "row_changed";

/**
 * Copies one file's bytes to `stored/<id>`, points its row there only if the
 * row still names the old key, and then deletes the old object. Safe to run
 * again after a failure at any step.
 */
export async function relocateStoredFile(file: FileToRelocate): Promise<RelocationOutcome> {
  const storage = getS3Storage();
  const target = durableKey(file.id);
  const bytes = await storage.download(file.storageKey);
  if (bytes.length !== file.byteSize) {
    throw new Error(`Stored file ${file.id} has ${bytes.length} bytes, expected ${file.byteSize}`);
  }
  await storage.upload(target, bytes, file.contentType);
  const moved = await db
    .update(storedFiles)
    .set({ storageKey: target })
    .where(and(eq(storedFiles.id, file.id), eq(storedFiles.storageKey, file.storageKey)))
    .returning({ id: storedFiles.id });
  if (moved.length === 0) return "row_changed";
  const removed = await storage.delete(file.storageKey);
  return removed.success ? "moved" : "moved_old_kept";
}

export interface ObjectsOutsideLayout {
  count: number;
  byteSize: number;
  /** The first few keys, for review. */
  sample: string[];
}

/** Objects under neither `stored/` nor `temporary/`, which the sweep will stop reaching. */
export async function findObjectsOutsideLayout(sampleSize = 5): Promise<ObjectsOutsideLayout> {
  const storage = getS3Storage();
  const result: ObjectsOutsideLayout = { count: 0, byteSize: 0, sample: [] };
  let continuationToken: string | null = null;
  do {
    const page = await storage.listObjectsPage("", continuationToken);
    for (const object of page.objects) {
      if (object.key.startsWith("stored/") || object.key.startsWith("temporary/")) continue;
      result.count += 1;
      result.byteSize += object.byteSize;
      if (result.sample.length < sampleSize) result.sample.push(object.key);
    }
    continuationToken = page.isTruncated ? page.nextContinuationToken : null;
  } while (continuationToken != null);
  return result;
}
