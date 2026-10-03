import { AppError } from "@/lib/errors";

/**
 * Request-body bound violation. Carries the number of bytes actually consumed
 * from the stream so failure metrics can report how far the request got
 * before rejection.
 */
export class RequestBodyTooLargeError extends AppError {
  readonly bytesRead: number;

  constructor(bytesRead: number) {
    super("Request body exceeds the maximum allowed size", "PAYLOAD_TOO_LARGE", 413);
    this.bytesRead = bytesRead;
  }
}

/**
 * Reads a request body into memory, refusing it as soon as it is known to
 * exceed `maxBytes`: from the declared length when there is one, otherwise
 * from the bytes actually received.
 */
export async function readBoundedBody(
  request: Request,
  maxBytes: number
): Promise<{ bytes: Uint8Array; length: number } | null> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestBodyTooLargeError(0);
  }
  if (request.body == null) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new RequestBodyTooLargeError(length);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, length };
}
