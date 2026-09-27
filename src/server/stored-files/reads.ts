import "server-only";
import { and, eq, exists, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { getS3Storage } from "@/lib/storage/s3";
import { sourceDocumentFiles, storedFiles } from "@/persistence";
import { mapStoredFile } from "./shared";
import type { AuthorizedFileReadContract, StoredFileContract } from "./types";

/**
 * A finalized file some document of the ledger lists among its inputs. The
 * document link cascades away with its document, so the link is enough.
 */
async function findAuthorizedFile(ledgerId: string, fileId: string) {
  const rows = await db
    .select({ file: storedFiles })
    .from(storedFiles)
    .where(
      and(
        eq(storedFiles.ledgerId, ledgerId),
        eq(storedFiles.id, fileId),
        isNotNull(storedFiles.finalizedAt),
        exists(
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
    .limit(1);
  return rows[0]?.file ?? null;
}

export async function readAuthorizedFile(
  ledgerId: string,
  fileId: string
): Promise<AuthorizedFileReadContract | null> {
  const row = await findAuthorizedFile(ledgerId, fileId);
  if (row == null) return null;
  const body = await getS3Storage().download(row.storageKey);
  return { file: mapStoredFile(row), body: new Uint8Array(body) };
}

export async function streamAuthorizedFile(
  ledgerId: string,
  fileId: string
): Promise<{ file: StoredFileContract; body: ReadableStream<Uint8Array> } | null> {
  const row = await findAuthorizedFile(ledgerId, fileId);
  if (row == null) return null;
  return { file: mapStoredFile(row), body: await getS3Storage().stream(row.storageKey) };
}
