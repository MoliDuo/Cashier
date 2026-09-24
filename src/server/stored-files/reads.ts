import "server-only";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { getS3Storage } from "@/lib/storage/s3";
import {
  ledgers,
  revisionFiles,
  sourceDocumentRevisions,
  sourceDocuments,
  storedFiles,
} from "@/persistence";
import { mapStoredFile } from "./shared";
import type { AuthorizedFileReadContract, StoredFileContract } from "./types";

function authorizedFileQuery() {
  return db
    .select({ file: storedFiles })
    .from(storedFiles)
    .innerJoin(ledgers, eq(ledgers.id, storedFiles.ledgerId))
    .innerJoin(
      revisionFiles,
      and(
        eq(revisionFiles.ledgerId, storedFiles.ledgerId),
        eq(revisionFiles.storedFileId, storedFiles.id)
      )
    )
    .innerJoin(
      sourceDocumentRevisions,
      and(
        eq(sourceDocumentRevisions.ledgerId, revisionFiles.ledgerId),
        eq(sourceDocumentRevisions.id, revisionFiles.revisionId)
      )
    )
    .innerJoin(
      sourceDocuments,
      and(
        eq(sourceDocuments.ledgerId, sourceDocumentRevisions.ledgerId),
        eq(sourceDocuments.id, sourceDocumentRevisions.sourceDocumentId)
      )
    );
}

/** A finalized file the ledger still references from a live source document. */
async function findAuthorizedFile(ledgerId: string, fileId: string) {
  const rows = await authorizedFileQuery()
    .where(
      and(
        eq(storedFiles.ledgerId, ledgerId),
        eq(storedFiles.id, fileId),
        isNotNull(storedFiles.finalizedAt),
        isNull(storedFiles.deletedAt),
        isNull(sourceDocuments.deletedAt)
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
