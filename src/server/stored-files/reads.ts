import "server-only";
import { and, eq, exists, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { getS3Storage } from "@/lib/storage/s3";
import { ledgers, sourceDocumentFiles, sourceDocuments, storedFiles } from "@/persistence";
import { mapStoredFile } from "./shared";
import type { AuthorizedFileReadContract, StoredFileContract } from "./types";

/** A live source document of the file's ledger lists the file among its inputs. */
function referencedByLiveDocument() {
  const byDocument = db
    .select({ id: sourceDocumentFiles.id })
    .from(sourceDocumentFiles)
    .innerJoin(
      sourceDocuments,
      and(
        eq(sourceDocuments.ledgerId, sourceDocumentFiles.ledgerId),
        eq(sourceDocuments.id, sourceDocumentFiles.sourceDocumentId)
      )
    )
    .where(
      and(
        eq(sourceDocumentFiles.ledgerId, storedFiles.ledgerId),
        eq(sourceDocumentFiles.storedFileId, storedFiles.id),
        isNull(sourceDocuments.deletedAt)
      )
    );
  return exists(byDocument);
}

/** A finalized file the ledger still references from a live source document. */
async function findAuthorizedFile(ledgerId: string, fileId: string) {
  const rows = await db
    .select({ file: storedFiles })
    .from(storedFiles)
    .innerJoin(ledgers, eq(ledgers.id, storedFiles.ledgerId))
    .where(
      and(
        eq(storedFiles.ledgerId, ledgerId),
        eq(storedFiles.id, fileId),
        isNotNull(storedFiles.finalizedAt),
        referencedByLiveDocument()
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
