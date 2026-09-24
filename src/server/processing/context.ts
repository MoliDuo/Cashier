import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import type {
  RevisionProcessingContextContract,
  RevisionProcessingRequestContract,
} from "@/server/processing/types";
import { db } from "@/lib/db";
import {
  entryCategories,
  revisionFiles,
  sourceDocumentRevisions,
  sourceDocuments,
} from "@/persistence";

export async function loadRevisionProcessingContext(
  request: RevisionProcessingRequestContract
): Promise<RevisionProcessingContextContract> {
  const [identity, files, categories] = await Promise.all([
    db
      .select({
        inputText: sourceDocumentRevisions.inputText,
        inputDocumentDate: sourceDocumentRevisions.inputDocumentDate,
        inputDateReference: sourceDocumentRevisions.inputDateReference,
        processingStatus: sourceDocumentRevisions.processingStatus,
        activeRevisionId: sourceDocuments.activeRevisionId,
        latestSubmissionRevisionId: sourceDocuments.latestSubmissionRevisionId,
        createdAt: sourceDocuments.createdAt,
      })
      .from(sourceDocumentRevisions)
      .innerJoin(
        sourceDocuments,
        and(
          eq(sourceDocuments.ledgerId, sourceDocumentRevisions.ledgerId),
          eq(sourceDocuments.id, sourceDocumentRevisions.sourceDocumentId),
          isNull(sourceDocuments.deletedAt)
        )
      )
      .where(
        and(
          eq(sourceDocumentRevisions.ledgerId, request.ledgerId),
          eq(sourceDocumentRevisions.sourceDocumentId, request.sourceDocumentId),
          eq(sourceDocumentRevisions.id, request.revisionId)
        )
      )
      .then((rows) => rows[0] ?? null),
    db
      .select({ id: revisionFiles.storedFileId })
      .from(revisionFiles)
      .where(
        and(
          eq(revisionFiles.ledgerId, request.ledgerId),
          eq(revisionFiles.revisionId, request.revisionId)
        )
      )
      .orderBy(asc(revisionFiles.position)),
    db
      .select({
        id: entryCategories.id,
        name: entryCategories.name,
        description: entryCategories.description,
      })
      .from(entryCategories)
      .where(and(eq(entryCategories.ledgerId, request.ledgerId), isNull(entryCategories.deletedAt)))
      .orderBy(
        asc(entryCategories.sortOrder),
        asc(entryCategories.createdAt),
        asc(entryCategories.id)
      ),
  ]);

  return {
    revision:
      identity == null
        ? null
        : {
            inputText: identity.inputText,
            inputDocumentDate: identity.inputDocumentDate,
            inputDateReference: identity.inputDateReference,
            processingStatus: identity.processingStatus,
          },
    document:
      identity == null
        ? null
        : {
            activeRevisionId: identity.activeRevisionId,
            latestSubmissionRevisionId: identity.latestSubmissionRevisionId,
            createdAt: identity.createdAt,
          },
    storedFileIds: files.map((file) => file.id),
    categories,
  };
}
