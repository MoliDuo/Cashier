import "server-only";
import { and, asc, eq } from "drizzle-orm";
import type {
  AttemptProcessingContextContract,
  AttemptProcessingRequestContract,
} from "@/server/processing/types";
import { db } from "@/lib/db";
import {
  entryCategories,
  sourceDocumentFiles,
  extractionAttempts,
  sourceDocuments,
} from "@/persistence";

export async function loadAttemptProcessingContext(
  request: AttemptProcessingRequestContract
): Promise<AttemptProcessingContextContract> {
  const [identity, files, categories] = await Promise.all([
    db
      .select({
        inputText: sourceDocuments.inputText,
        requestedDate: extractionAttempts.requestedDate,
        referenceDate: extractionAttempts.referenceDate,
        processingStatus: extractionAttempts.status,
        latestAttemptId: sourceDocuments.latestAttemptId,
        createdAt: sourceDocuments.createdAt,
      })
      .from(extractionAttempts)
      .innerJoin(
        sourceDocuments,
        and(
          eq(sourceDocuments.ledgerId, extractionAttempts.ledgerId),
          eq(sourceDocuments.id, extractionAttempts.sourceDocumentId)
        )
      )
      .where(
        and(
          eq(extractionAttempts.ledgerId, request.ledgerId),
          eq(extractionAttempts.sourceDocumentId, request.sourceDocumentId),
          eq(extractionAttempts.id, request.attemptId)
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
    attempt:
      identity == null
        ? null
        : {
            inputText: identity.inputText,
            requestedDate: identity.requestedDate,
            referenceDate: identity.referenceDate,
            processingStatus: identity.processingStatus,
          },
    document:
      identity == null
        ? null
        : {
            latestAttemptId: identity.latestAttemptId,
            createdAt: identity.createdAt,
          },
    storedFileIds: files.map((file) => file.id),
    categories,
  };
}
