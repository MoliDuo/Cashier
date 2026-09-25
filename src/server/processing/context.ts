import "server-only";
import { and, asc, eq } from "drizzle-orm";
import type {
  RevisionProcessingContextContract,
  RevisionProcessingRequestContract,
} from "@/server/processing/types";
import { db } from "@/lib/db";
import {
  entryCategories,
  sourceDocumentFiles,
  sourceDocumentRevisions,
  sourceDocuments,
} from "@/persistence";

export async function loadRevisionProcessingContext(
  request: RevisionProcessingRequestContract
): Promise<RevisionProcessingContextContract> {
  const [identity, files, categories] = await Promise.all([
    db
      .select({
        inputText: sourceDocuments.inputText,
        inputDocumentDate: sourceDocumentRevisions.inputDocumentDate,
        inputDateReference: sourceDocumentRevisions.inputDateReference,
        processingStatus: sourceDocumentRevisions.processingStatus,
        latestSubmissionRevisionId: sourceDocuments.latestSubmissionRevisionId,
        createdAt: sourceDocuments.createdAt,
      })
      .from(sourceDocumentRevisions)
      .innerJoin(
        sourceDocuments,
        and(
          eq(sourceDocuments.ledgerId, sourceDocumentRevisions.ledgerId),
          eq(sourceDocuments.id, sourceDocumentRevisions.sourceDocumentId)
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
    // The document's current input is the input of its latest submission,
    // which the caller only processes while it is that submission.
    db
      .select({ id: sourceDocumentFiles.storedFileId })
      .from(sourceDocumentFiles)
      .where(
        and(
          eq(sourceDocumentFiles.ledgerId, request.ledgerId),
          eq(sourceDocumentFiles.sourceDocumentId, request.sourceDocumentId)
        )
      )
      .orderBy(asc(sourceDocumentFiles.position)),
    db
      .select({
        id: entryCategories.id,
        name: entryCategories.name,
        description: entryCategories.description,
      })
      .from(entryCategories)
      .where(eq(entryCategories.ledgerId, request.ledgerId))
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
            latestSubmissionRevisionId: identity.latestSubmissionRevisionId,
            createdAt: identity.createdAt,
          },
    storedFileIds: files.map((file) => file.id),
    categories,
  };
}
