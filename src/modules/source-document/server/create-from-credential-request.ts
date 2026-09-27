import "server-only";
import { createHash } from "crypto";
import type { AuthenticatedServiceCredential } from "@/modules/ledger/contracts";
import { getLedgerSettings } from "@/modules/ledger/server/settings";
import { NotFoundError } from "@/lib/errors";
import type { SourceDocumentSubmissionContract } from "@/modules/source-document/server/submissions";
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
  // An upload without a day of its own is dated today in the ledger's zone.
  const settings = await getLedgerSettings(credential.ledgerId);
  if (settings == null) throw new NotFoundError("Ledger");

  const result = await createAndQueueSourceDocument({
    ledgerId: credential.ledgerId,
    bookId: credential.bookId,
    input: { kind: "inline", images: payload.images },
    ...(payload.entryDate == null ? {} : { documentDate: payload.entryDate }),
    timeZone: settings.timeZone,
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

  // Also recover older pending intents for the ledger. The claim CAS makes
  // duplicate scheduling harmless.
  scheduleProcessingRecoveryAfter(credential.ledgerId, input.requestId);

  return result;
}
