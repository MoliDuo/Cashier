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
import { sourceDocumentFingerprint } from "@/modules/source-document/source-document-fingerprint";

/**
 * Create a new source document and trigger processing.
 */
export const createSourceDocumentAction = withSourceDocumentLedgerAccess(
  async (
    { userId, ledger },
    input: CreateSourceDocumentInputContract,
    clientSubmissionId: string
  ): Promise<CreateSourceDocumentResponseDto> => {
    const validated = createSourceDocumentInputSchema.parse(input);
    const validatedClientSubmissionId = clientSubmissionIdSchema.parse(clientSubmissionId);
    const payload = omitUndefinedProperties(validated);
    // Resolved before the write, never in it. The ledger's zone dates the
    // record; where the reader happened to be does not.
    const book = await resolveRecordBook(validated.bookId);
    const result = await createAndQueueSourceDocument({
      bookId: book.id,
      input: {
        kind: "stored",
        ...(payload.text == null ? {} : { text: payload.text }),
        storedFileIds: payload.storedFileIds ?? [],
      },
      ...(payload.documentDate == null ? {} : { documentDate: payload.documentDate }),
      timeZone: ledger.settings.timeZone,
      idempotency: {
        principalType: "user",
        principalId: userId,
        key: validatedClientSubmissionId,
        contentFingerprint: sourceDocumentFingerprint(payload),
      },
    });

    // Also recover any missed processing intents
    scheduleProcessingRecoveryAfter();

    return { sourceDocumentId: result.sourceDocumentId, version: 1, status: "processing" };
  }
);
