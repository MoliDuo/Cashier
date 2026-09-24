import { type NextRequest, NextResponse } from "next/server";

export const maxDuration = 120;
import { createSourceDocumentFromCredentialRequest } from "@/modules/source-document/server/create-from-credential-request";
import { AppError, ValidationError } from "@/lib/errors";
import { ApiV1HandlerFailure, handleApiV1Route } from "@/server/api-v1/request-pipeline";
import { toApiV1SourceDocumentCreateResponse } from "@/app/api/v1/_shared/compatibility";
import {
  apiV1IdempotencyKeySchema,
  createSourceDocumentInputSchemaV1,
} from "@/modules/source-document/contract-schemas";
import { API_V1_MAX_REQUEST_BYTES } from "@/modules/source-document/api-v1-policy";

/**
 * Request-body bound violation. Carries the number of bytes actually consumed
 * from the stream so failure metrics can report how far the request got
 * before rejection.
 */
class RequestBodyTooLargeError extends AppError {
  readonly bytesRead: number;

  constructor(bytesRead: number) {
    super("Request body exceeds the maximum allowed size", "PAYLOAD_TOO_LARGE", 413);
    this.bytesRead = bytesRead;
  }
}

async function readBoundedJson(request: NextRequest): Promise<{ data: unknown; bytes: number }> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > API_V1_MAX_REQUEST_BYTES) {
    throw new RequestBodyTooLargeError(0);
  }
  if (request.body == null) throw new ValidationError("Invalid JSON body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > API_V1_MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new RequestBodyTooLargeError(bytes);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(merged)) as unknown;
  } catch {
    throw new ValidationError("Invalid JSON body");
  }
  return { data, bytes };
}

export async function POST(request: NextRequest) {
  return handleApiV1Route(request, {
    logContext: "api/v1/source-documents",
    handler: async ({ credential, request: authorizedRequest, requestId }) => {
      const bodyReadStart = performance.now();
      let bodyBytes = 0;
      let bodyReadMs = 0;
      let parseMs = 0;
      let createMs = 0;
      let imageCount = 0;
      let decodedBytes = 0;
      try {
        // Validate Idempotency-Key before reading or decoding the request
        // body, so an invalid key can never trigger image decoding or uploads.
        const idempotencyHeader = authorizedRequest.headers.get("Idempotency-Key");
        let idempotencyKey: string | undefined;
        if (idempotencyHeader != null) {
          const parsedKey = apiV1IdempotencyKeySchema.safeParse(idempotencyHeader);
          if (!parsedKey.success) {
            throw new ValidationError("Validation failed", {
              issues: parsedKey.error.issues,
            });
          }
          idempotencyKey = parsedKey.data;
        }

        const body = await readBoundedJson(authorizedRequest);
        bodyBytes = body.bytes;
        bodyReadMs = performance.now() - bodyReadStart;

        const parseStart = performance.now();
        const parsed = createSourceDocumentInputSchemaV1.safeParse(body.data);
        parseMs = performance.now() - parseStart;
        if (!parsed.success) {
          throw new ValidationError("Validation failed", {
            issues: parsed.error.issues,
          });
        }
        imageCount = parsed.data.images.length;
        decodedBytes = parsed.data.images.reduce((total, image) => total + image.bytes.length, 0);

        const createStart = performance.now();
        let createResult: Awaited<ReturnType<typeof createSourceDocumentFromCredentialRequest>>;
        try {
          createResult = await createSourceDocumentFromCredentialRequest({
            credential,
            ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
            requestId,
            payload: {
              images: parsed.data.images,
              ...(parsed.data.entryDate === undefined ? {} : { entryDate: parsed.data.entryDate }),
            },
          });
        } finally {
          createMs = performance.now() - createStart;
        }

        const response = NextResponse.json(toApiV1SourceDocumentCreateResponse(createResult), {
          status: 201,
        });
        response.headers.set(
          "Location",
          `/api/v1/source-documents/${createResult.sourceDocumentId}`
        );
        return {
          response,
          metrics: {
            requestBytes: bodyBytes,
            imageCount,
            decodedBytes,
            stages: {
              bodyReadMs: Math.round(bodyReadMs),
              parseMs: Math.round(parseMs),
              createMs: Math.round(createMs),
            },
          },
        };
      } catch (error) {
        const bodyLimitHit = error instanceof RequestBodyTooLargeError;
        throw new ApiV1HandlerFailure(error, {
          requestBytes: bodyLimitHit ? error.bytesRead : bodyBytes,
          imageCount,
          decodedBytes,
          stages: {
            bodyReadMs: Math.round(
              bodyReadMs === 0 ? performance.now() - bodyReadStart : bodyReadMs
            ),
            parseMs: Math.round(parseMs),
            createMs: Math.round(createMs),
          },
        });
      }
    },
  });
}
