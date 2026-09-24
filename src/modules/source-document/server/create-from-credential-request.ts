import type { ProcessingJobContract } from "@/application/contracts";
import type { AuthenticatedServiceCredential } from "@/modules/ledger/contracts";
import { getBook } from "@/modules/ledger/server/books";
import { serverComposition } from "@/application/server-composition-root";
import { scheduleRequestMaintenance } from "@/application/transport/request-maintenance";
import type { SourceDocumentSubmissionContract } from "@/application/contracts";
import type { PreparedApiV1SourceDocumentInput } from "@/modules/source-document/api-v1-policy";
import { createSourceDocumentFromCredential } from "../application/use-cases/create-from-credential";
import { scheduleProcessingAfter } from "@/application/processing/schedule-processing";
import { scheduleProcessingRecoveryAfter } from "@/application/processing/schedule-processing-recovery";

/**
 * Server-only facade for POST /api/v1/source-documents.
 *
 * A plain module function (not a "use server" action) that owns port injection
 * and request-bound `after()` callbacks for the credential ingestion use case.
 */
export async function createSourceDocumentFromCredentialRequest(input: {
  credential: AuthenticatedServiceCredential;
  idempotencyKey?: string;
  requestId?: string;
  payload: PreparedApiV1SourceDocumentInput;
}): Promise<SourceDocumentSubmissionContract> {
  const scheduleProcessing = (job: ProcessingJobContract) => {
    scheduleProcessingAfter(job, input.requestId);
  };

  // The key's book owns the date zone: an upload through 梁梁的 is dated in that
  // book's day rather than the server's, and a book with no zone of its own
  // falls back to the server date.
  const book = await getBook(input.credential.ledgerId, input.credential.bookId);

  const result = await createSourceDocumentFromCredential(
    {
      credential: input.credential,
      ...(input.idempotencyKey == null ? {} : { idempotencyKey: input.idempotencyKey }),
      payload: input.payload,
      ...(book?.timeZone == null ? {} : { timezone: book.timeZone }),
    },
    scheduleProcessing,
    {
      submissions: {
        submit: serverComposition.sourceDocumentAggregate.createProcessingDocument,
        submitIdempotently:
          serverComposition.sourceDocumentAggregate.createIdempotentProcessingDocument,
      },
      storedFiles: serverComposition.storedFiles,
    }
  );

  // Also recover older pending intents for the ledger and run bounded
  // maintenance. The claim CAS makes duplicate scheduling harmless.
  scheduleProcessingRecoveryAfter(input.credential.ledgerId, input.requestId);
  scheduleRequestMaintenance();

  return result;
}
