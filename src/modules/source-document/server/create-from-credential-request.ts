import "server-only";
import { createHash } from "crypto";
import type { AuthenticatedServiceCredential } from "@/modules/ledger/contracts";
import { getBook } from "@/modules/ledger/server/books";
import { scheduleRequestMaintenance } from "@/application/transport/request-maintenance";
import type { SourceDocumentSubmissionContract } from "@/application/contracts";
import type { PreparedApiV1SourceDocumentInput } from "@/modules/source-document/api-v1-policy";
import { scheduleProcessingRecoveryAfter } from "@/server/processing/recovery";
import { createAndQueueSourceDocument } from "./create-and-queue";

function contentFingerprint(payload: PreparedApiV1SourceDocumentInput): string {
  const hash = createHash("sha256");
  hash.update("cashier-api-v1\0");
  hash.update(
    JSON.stringify({
      text: null,
      entryDate: payload.entryDate ?? null,
      timezone: null,
      storedFileIds: [],
      images: payload.images.map((image) => ({
        mimeType: image.mimeType,
        contentHash: image.contentHash,
      })),
      originalImages: [],
    })
  );
  return hash.digest("hex");
}

/**
 * Server-only entry point for POST /api/v1/source-documents.
 *
 * A plain module function (not a "use server" action) that owns the
 * request-bound `after()` callbacks for credential ingestion.
 */
export async function createSourceDocumentFromCredentialRequest(input: {
  credential: AuthenticatedServiceCredential;
  idempotencyKey?: string;
  requestId?: string;
  payload: PreparedApiV1SourceDocumentInput;
}): Promise<SourceDocumentSubmissionContract> {
  const { credential, payload } = input;
  // The key's book owns the date zone: an upload through 梁梁的 is dated in that
  // book's day rather than the server's, and a book with no zone of its own
  // falls back to the server date.
  const book = await getBook(credential.ledgerId, credential.bookId);

  const result = await createAndQueueSourceDocument({
    ledgerId: credential.ledgerId,
    bookId: credential.bookId,
    input: { kind: "inline", images: payload.images },
    ...(payload.entryDate == null ? {} : { documentDate: payload.entryDate }),
    ...(book?.timeZone == null ? {} : { timezone: book.timeZone }),
    ...(input.idempotencyKey == null
      ? {}
      : {
          idempotency: {
            principalType: "credential",
            principalId: credential.id,
            key: input.idempotencyKey,
            contentFingerprint: contentFingerprint(payload),
          },
        }),
    ...(input.requestId == null ? {} : { requestId: input.requestId }),
  });

  // Also recover older pending intents for the ledger and run bounded
  // maintenance. The claim CAS makes duplicate scheduling harmless.
  scheduleProcessingRecoveryAfter(credential.ledgerId, input.requestId);
  scheduleRequestMaintenance();

  return result;
}
