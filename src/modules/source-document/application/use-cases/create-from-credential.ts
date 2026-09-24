import type {
  ProcessingJobContract,
  SourceDocumentSubmissionContract,
} from "@/application/contracts";
import type { AuthenticatedServiceCredential } from "@/modules/ledger/contracts";
import { processImage as processImageFn } from "@/lib/storage/image-processing";
import { createAndQueueSourceDocument } from "./create-and-queue-source-document";
import { createHash } from "crypto";
import type { PreparedApiV1SourceDocumentInput } from "@/modules/source-document/api-v1-policy";
import type { SourceDocumentCredentialPorts } from "../ports";
import { ValidationError } from "@/lib/errors";

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

export async function createSourceDocumentFromCredential(
  input: {
    credential: AuthenticatedServiceCredential;
    idempotencyKey?: string;
    payload: PreparedApiV1SourceDocumentInput;
    /**
     * The key's book zone, resolved by the caller before this runs. A book with
     * no zone of its own leaves the server date to decide, as today.
     */
    timezone?: string;
  },
  scheduleProcessing: (job: ProcessingJobContract) => void,
  ports: SourceDocumentCredentialPorts
): Promise<SourceDocumentSubmissionContract> {
  if (input.credential.bookId == null) throw new ValidationError("Credential book is required");
  const payload = input.payload;
  return createAndQueueSourceDocument(
    {
      ledgerId: input.credential.ledgerId,
      bookId: input.credential.bookId,
      input: { kind: "inline", images: payload.images },
      ...(payload.entryDate == null ? {} : { documentDate: payload.entryDate }),
      ...(input.timezone == null ? {} : { timezone: input.timezone }),
      ...(input.idempotencyKey == null
        ? {}
        : {
            idempotency: {
              principalType: "credential",
              principalId: input.credential.id,
              key: input.idempotencyKey,
              contentFingerprint: contentFingerprint(payload),
            },
          }),
    },
    {
      submissions: ports.submissions,
      storedFiles: ports.storedFiles,
      processImage: processImageFn,
      scheduleProcessing,
    }
  );
}
