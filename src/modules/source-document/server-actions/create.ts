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
import { withSourceDocumentLedgerAccess } from "./access";
import { scheduleProcessingRecoveryAfter } from "@/application/processing/schedule-processing-recovery";
import { scheduleProcessingAfter } from "@/application/processing/schedule-processing";
import { scheduleRequestMaintenance } from "@/application/transport/request-maintenance";
import { sourceDocumentFingerprint } from "@/modules/source-document/source-document-fingerprint";
import { isCoupleMember } from "@/lib/couple-config";
import { ValidationError } from "@/lib/errors";

/**
 * Create a new source document and trigger processing.
 */
export const createSourceDocumentAction = withSourceDocumentLedgerAccess(
  async (
    { ledgerId, ledger, userId },
    input: CreateSourceDocumentInputContract,
    clientSubmissionId: string
  ): Promise<CreateSourceDocumentResponseDto> => {
    const validated = createSourceDocumentInputSchema.parse(input);
    const attributedUserId = validated.attributedUserId ?? userId;
    if (!isCoupleMember(attributedUserId)) throw new ValidationError("Invalid member attribution");
    const validatedClientSubmissionId = clientSubmissionIdSchema.parse(clientSubmissionId);
    const payload = omitUndefinedProperties(validated);
    const timezone = payload.timezone ?? ledger.settings.timeZone ?? undefined;
    const scheduleProcessing = (job: ProcessingJobContract) => {
      scheduleProcessingAfter(job);
    };

    const result = await createAndQueueSourceDocument(
      {
        ledgerId,
        attributedUserId,
        createdByUserId: userId,
        input: {
          kind: "stored",
          ...(payload.text == null ? {} : { text: payload.text }),
          storedFileIds: payload.storedFileIds ?? [],
        },
        ...(payload.documentDate == null ? {} : { documentDate: payload.documentDate }),
        ...(timezone === undefined ? {} : { timezone }),
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
