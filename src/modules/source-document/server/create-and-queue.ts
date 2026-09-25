import "server-only";
import { ValidationError } from "@/lib/errors";
import { formatDateTimeForApi, getDateInTimezone } from "@/lib/date-utils";
import { validateAggregateFileCount } from "@/lib/storage/upload-policy";
import { discardUnusedFiles } from "@/server/stored-files/uploads";
import { scheduleProcessingAfter } from "@/server/processing/schedule";
import {
  findIdempotentSubmission,
  submitSourceDocument,
  submitSourceDocumentIdempotently,
  type SourceDocumentIdempotencyInput,
  type SourceDocumentSubmissionContract,
} from "./submissions";
import type { PreparedInlineImage } from "@/modules/source-document/api-v1-policy";
import { prepareInlineImages } from "./prepare-inline-images";

export interface CreateAndQueueSourceDocumentInput {
  ledgerId: string;
  /** The book the new record is filed under. */
  bookId: string;
  input:
    | { kind: "stored"; text?: string; storedFileIds: string[] }
    | { kind: "inline"; images: PreparedInlineImage[] };
  documentDate?: string;
  timezone?: string;
  idempotency?: SourceDocumentIdempotencyInput;
  /** Correlates the processing `after()` with the request that queued it. */
  requestId?: string;
}

function resolveDocumentDate(documentDate?: string, timezone?: string): string {
  if (documentDate != null && documentDate !== "") return documentDate;
  return getDateInTimezone(timezone) ?? formatDateTimeForApi(new Date());
}

export async function createAndQueueSourceDocument(
  input: CreateAndQueueSourceDocumentInput
): Promise<SourceDocumentSubmissionContract> {
  const storedInput = input.input.kind === "stored" ? input.input : null;
  const inlineImages = input.input.kind === "inline" ? input.input.images : [];
  validateAggregateFileCount(storedInput?.storedFileIds.length ?? inlineImages.length, 0);
  if (
    storedInput != null &&
    (storedInput.text == null || storedInput.text === "") &&
    storedInput.storedFileIds.length === 0
  ) {
    throw new ValidationError("Content (text or images) is required");
  }
  if (input.input.kind === "inline" && inlineImages.length === 0) {
    throw new ValidationError("Content (text or images) is required");
  }

  // A repeated request finds its document before any image is processed.
  if (input.idempotency != null) {
    const existing = await findIdempotentSubmission(input.ledgerId, input.idempotency);
    if (existing != null) return existing;
  }

  let storedImageIds: string[] = [];
  try {
    const resolvedDate = resolveDocumentDate(input.documentDate, input.timezone);
    if (inlineImages.length > 0) {
      storedImageIds = (await prepareInlineImages(inlineImages, input.ledgerId)).storedFileIds;
    }
    const submission = {
      ledgerId: input.ledgerId,
      bookId: input.bookId,
      input: {
        text: storedInput?.text ?? null,
        storedFileIds: [...(storedInput?.storedFileIds ?? []), ...storedImageIds],
        documentDate: resolvedDate,
        dateReference: resolvedDate,
      },
    };
    let pending;
    if (input.idempotency == null) {
      pending = await submitSourceDocument(submission);
    } else {
      const result = await submitSourceDocumentIdempotently(submission, input.idempotency);
      if (result.replayed) {
        // A concurrent repeat created the document first; these images are unused.
        await discardUnusedFiles(input.ledgerId, storedImageIds);
        return result.existing;
      }
      pending = result.submission;
    }
    scheduleProcessingAfter(pending.job, input.requestId);
    return {
      sourceDocumentId: pending.document.id,
      revisionId: pending.revision.id,
      processingStatus: "processing",
    };
  } catch (error) {
    // Images stored for a submission that did not happen are nobody's.
    await discardUnusedFiles(input.ledgerId, storedImageIds);
    throw error;
  }
}
