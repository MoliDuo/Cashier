import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import type { SourceDocumentInputDto } from "@/modules/source-document/contracts";
import {
  sourceDocumentFiles,
  sourceDocumentRevisions,
  sourceDocuments,
  storedFiles,
} from "@/persistence";
import { mapStoredFileDto } from "./mappers";

/** Read only the document's current input required to seed an edit-and-retry draft. */
export async function getSourceDocumentInput(
  ledgerId: string,
  sourceDocumentId: string
): Promise<SourceDocumentInputDto | null> {
  return db.transaction(
    async (tx) => {
      const document = await tx
        .select({
          id: sourceDocuments.id,
          processingStatus: sourceDocumentRevisions.processingStatus,
          documentDate: sourceDocumentRevisions.inputDocumentDate,
          createdAt: sourceDocuments.createdAt,
          text: sourceDocuments.inputText,
        })
        .from(sourceDocuments)
        .leftJoin(
          sourceDocumentRevisions,
          and(
            eq(sourceDocumentRevisions.ledgerId, sourceDocuments.ledgerId),
            eq(sourceDocumentRevisions.sourceDocumentId, sourceDocuments.id),
            eq(sourceDocumentRevisions.id, sourceDocuments.latestSubmissionRevisionId)
          )
        )
        .where(
          and(
            eq(sourceDocuments.ledgerId, ledgerId),
            eq(sourceDocuments.id, sourceDocumentId),
            isNull(sourceDocuments.deletedAt)
          )
        )
        .limit(1)
        .then((rows) => rows[0]);
      if (document == null) return null;

      const files = await tx
        .select({
          id: storedFiles.id,
          contentType: storedFiles.contentType,
          byteSize: storedFiles.byteSize,
          originalFilename: storedFiles.originalFilename,
        })
        .from(sourceDocumentFiles)
        .innerJoin(
          storedFiles,
          and(
            eq(storedFiles.ledgerId, sourceDocumentFiles.ledgerId),
            eq(storedFiles.id, sourceDocumentFiles.storedFileId),
            isNull(storedFiles.deletedAt)
          )
        )
        .where(
          and(
            eq(sourceDocumentFiles.ledgerId, ledgerId),
            eq(sourceDocumentFiles.sourceDocumentId, sourceDocumentId)
          )
        )
        .orderBy(asc(sourceDocumentFiles.position));

      return {
        id: document.id,
        text: document.text,
        files: files.map(mapStoredFileDto),
        processingStatus: document.processingStatus,
        documentDate: document.documentDate,
        createdAt: document.createdAt.toISOString(),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" }
  );
}
