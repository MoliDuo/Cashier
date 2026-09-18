"use server";
import type { ProcessingJobContract } from "@/application/contracts";
import { serverComposition } from "@/application/server-composition-root";
import { processImage as processImageFn } from "@/lib/storage/image-processing";
import type { CreateSourceDocumentResponseDto } from "@/modules/source-document/contracts";
import {
  createSourceDocumentInputSchema,
  clientSubmissionIdSchema,
  type CreateSourceDocumentInputContract,
} from "@/modules/source-document/contract-schemas";
import { omitUndefinedProperties } from "@/lib/validation";
import { createAndQueueSourceDocument } from "../application/use-cases/create-and-queue-source-document";
import { resolveRecordBook } from "../server/resolve-record-book";
import { withSourceDocumentLedgerAccess } from "./access";
import { scheduleProcessingRecoveryAfter } from "@/application/processing/schedule-processing-recovery";
import { scheduleProcessingAfter } from "@/application/processing/schedule-processing";
import { scheduleRequestMaintenance } from "@/application/transport/request-maintenance";
import { sourceDocumentFingerprint } from "@/modules/source-document/source-document-fingerprint";

/**
 * Create a new source document and trigger processing.
 */
export const createSourceDocumentAction = withSourceDocumentLedgerAccess(
  async (
    { ledgerId, userId },
    input: CreateSourceDocumentInputContract,
    clientSubmissionId: string
  ): Promise<CreateSourceDocumentResponseDto> => {
    const validated = createSourceDocumentInputSchema.parse(input);
    const validatedClientSubmissionId = clientSubmissionIdSchema.parse(clientSubmissionId);
    const payload = omitUndefinedProperties(validated);
    // The book is what owns the date zone: the record belongs to it, so an
    // upload through 哞哞的 is dated in that book's zone unless the request sent
    // its own. The zone is resolved before the write, never inside it.
    const book = await resolveRecordBook(ledgerId, validated.bookId, serverComposition.books);
    const timezone = payload.timezone ?? book.timeZone;
    const scheduleProcessing = (job: ProcessingJobContract) => {
      scheduleProcessingAfter(job);
    };

    const result = await createAndQueueSourceDocument(
      {
        ledgerId,
        bookId: book.id,
        input: {
          kind: "stored",
          ...(payload.text == null ? {} : { text: payload.text }),
          storedFileIds: payload.storedFileIds ?? [],
        },
        ...(payload.documentDate == null ? {} : { documentDate: payload.documentDate }),
        ...(timezone == null ? {} : { timezone }),
        idempotency: {
          principalType: "user",
          principalId: userId,
          key: `source-document:create:${ledgerId}:new:${validatedClientSubmissionId}`,
          contentFingerprint: sourceDocumentFingerprint(payload),
        },
      },
      {
        submissions: {
          submit: serverComposition.sourceDocumentAggregate.createProcessingDocument,
          submitIdempotently:
            serverComposition.sourceDocumentAggregate.createIdempotentProcessingDocument,
        },
        storedFiles: serverComposition.storedFiles,
        processImage: processImageFn,
        scheduleProcessing,
      }
    );

    // Also recover any missed processing intents
    scheduleProcessingRecoveryAfter(ledgerId);
    scheduleRequestMaintenance();

    return { sourceDocumentId: result.sourceDocumentId, version: 1, status: "processing" };
  }
);
