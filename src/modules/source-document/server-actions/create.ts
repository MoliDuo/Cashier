"use server";
import type { CreateSourceDocumentResponseDto } from "@/modules/source-document/contracts";
import {
  createSourceDocumentInputSchema,
  clientSubmissionIdSchema,
  type CreateSourceDocumentInputContract,
} from "@/modules/source-document/contract-schemas";
import { omitUndefinedProperties } from "@/lib/validation";
import { createAndQueueSourceDocument } from "../server/create-and-queue";
import { resolveRecordBook } from "../server/resolve-record-book";
import { withSourceDocumentLedgerAccess } from "./access";
import { scheduleProcessingRecoveryAfter } from "@/server/processing/recovery";
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
    // The book is what owns the date zone: the record belongs to it, so a record
    // filed into 哞哞的 is dated in that book's zone. The request's own zone is
    // only a fallback for a book that has none — it is where the reader happened
    // to be, not where the record belongs. Resolved before the write, never in it.
    const book = await resolveRecordBook(ledgerId, validated.bookId);
    const timezone = book.timeZone ?? payload.timezone;
    const result = await createAndQueueSourceDocument({
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
    });

    // Also recover any missed processing intents
    scheduleProcessingRecoveryAfter(ledgerId);
    scheduleRequestMaintenance();

    return { sourceDocumentId: result.sourceDocumentId, version: 1, status: "processing" };
  }
);
