import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import type { SourceDocumentInputDto } from "@/modules/source-document/contracts";
import {
  revisionFiles,
  sourceDocumentRevisions,
  sourceDocuments,
  storedFiles,
} from "@/persistence";
import { mapStoredFileDto } from "./mappers";

/** Read only the latest submitted input required to seed an edit-and-retry draft. */
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
          revisionId: sourceDocuments.latestSubmissionRevisionId,
          text: sourceDocumentRevisions.inputText,
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

      const files =
        document.revisionId == null
          ? []
          : await tx
              .select({
                id: storedFiles.id,
                contentType: storedFiles.contentType,
                byteSize: storedFiles.byteSize,
                originalFilename: storedFiles.originalFilename,
              })
              .from(revisionFiles)
              .innerJoin(
                storedFiles,
                and(
                  eq(storedFiles.ledgerId, revisionFiles.ledgerId),
                  eq(storedFiles.id, revisionFiles.storedFileId),
                  isNull(storedFiles.deletedAt)
                )
              )
              .where(
                and(
                  eq(revisionFiles.ledgerId, ledgerId),
                  eq(revisionFiles.revisionId, document.revisionId)
                )
              )
              .orderBy(asc(revisionFiles.position));

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
