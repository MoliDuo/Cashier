import { type NextRequest, NextResponse } from "next/server";
import { requireLedgerAccess } from "@/modules/ledger/access";
import { ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getErrorStatusCode, toSanitizedErrorResponse } from "@/lib/error-handlers";
import { readBoundedBody } from "@/lib/http/bounded-body";
import { MAX_ORIGINAL_BYTES_PER_FILE, SUPPORTED_MIME_SET } from "@/lib/storage/upload-policy";
import { storeUploadedImage } from "@/server/stored-files/uploads";

const CACHE_CONTROL = "private, no-store";

/** The name travels percent-encoded in a header; anything unreadable is dropped, not an error. */
function readFilename(request: NextRequest): string | null {
  const header = request.headers.get("x-filename");
  if (header == null || header === "") return null;
  try {
    const name = decodeURIComponent(header).replace(/[\u0000-\u001f\u007f]/g, "");
    return name === "" ? null : name;
  } catch {
    return null;
  }
}

/**
 * Stores one image: the request body is the raw file, its type is the Content-Type and its name the
 * percent-encoded X-Filename. The server normalizes it and answers with the stored file, whose id the
 * submission then names.
 */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    await requireLedgerAccess();
    const contentType = (request.headers.get("content-type") ?? "").split(";")[0]!.trim();
    if (!SUPPORTED_MIME_SET.has(contentType.toLowerCase())) {
      throw new ValidationError("Unsupported upload content type");
    }
    const body = await readBoundedBody(request, MAX_ORIGINAL_BYTES_PER_FILE);
    if (body == null || body.length === 0) throw new ValidationError("Upload body is empty");
    const file = await storeUploadedImage({
      bytes: Buffer.from(body.bytes.buffer, body.bytes.byteOffset, body.bytes.byteLength),
      contentType: contentType.toLowerCase(),
      originalFilename: readFilename(request),
    });
    return NextResponse.json(file, {
      status: 201,
      headers: { "Cache-Control": CACHE_CONTROL, "X-Request-Id": requestId },
    });
  } catch (error) {
    const status = getErrorStatusCode(error);
    const body = toSanitizedErrorResponse(error);
    logger[status < 500 ? "warn" : "error"](
      { requestId, status, errorCode: body.error.code },
      status < 500 ? "Stored file upload rejected" : "Stored file upload failed"
    );
    return NextResponse.json(body, {
      status,
      headers: { "Cache-Control": CACHE_CONTROL, "X-Request-Id": requestId },
    });
  }
}
