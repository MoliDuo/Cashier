import "server-only";
import { ValidationError } from "@/lib/errors";
import { formatDateTimeForApi, getDateInTimezone } from "@/lib/date-utils";
import type { SourceDocumentSubmissionContract } from "@/application/contracts";
import { toSourceDocumentSubmissionContract } from "@/application/contracts";
import { validateAggregateFileCount } from "@/lib/storage/upload-policy";
import { processImage } from "@/lib/storage/image-processing";
import { storedFileAdapter } from "@/application/adapters/storage";
import { scheduleProcessingAfter } from "@/server/processing/schedule";
import { submitSourceDocument, submitSourceDocumentIdempotently } from "./submissions";
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
  idempotency?: {
    principalType: "credential" | "user";
    principalId: string;
    key: string;
    contentFingerprint: string | null;
  };
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
  let createdUploadSessionId: string | null = null;
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

  const prepareSubmission = async () => {
    const resolvedDate = resolveDocumentDate(input.documentDate, input.timezone);
    const preparedImages =
      inlineImages.length > 0
        ? await prepareInlineImages(inlineImages, storedFileAdapter, processImage, input.ledgerId)
        : null;
    createdUploadSessionId = preparedImages?.uploadSessionId ?? null;
    const processedImageIds = preparedImages?.storedFileIds ?? [];

    return {
      ledgerId: input.ledgerId,
      bookId: input.bookId,
      input: {
        text: storedInput?.text ?? null,
        storedFileIds: [...(storedInput?.storedFileIds ?? []), ...processedImageIds],
        documentDate: resolvedDate,
        dateReference: resolvedDate,
      },
    };
  };

  let pending;
  try {
    pending = input.idempotency
      ? await submitSourceDocumentIdempotently(input.idempotency, prepareSubmission)
      : await submitSourceDocument(await prepareSubmission());
  } catch (error) {
    if (createdUploadSessionId != null) {
      try {
        await storedFileAdapter.abandonUploadSession(input.ledgerId, createdUploadSessionId);
      } catch {
        // prepareInlineImages already records cleanup diagnostics; preserve the submission error.
      }
    }
    throw error;
  }
  if (pending.idempotencyReplay !== true) scheduleProcessingAfter(pending.job, input.requestId);
  return toSourceDocumentSubmissionContract(pending.document, pending.revision);
}
