import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/modules/auth/server/session-guards";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getErrorStatusCode, toSanitizedErrorResponse } from "@/lib/error-handlers";
import { UUID_REGEX } from "@/lib/validation";
import { getLiveLedger } from "@/modules/ledger/server/live-ledger";
import { streamAuthorizedFile } from "@/server/stored-files/reads";

const CACHE_CONTROL = "private, no-store";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const requestId = crypto.randomUUID();
  try {
    const userId = await requireAuth();
    const { fileId } = await params;
    if (!UUID_REGEX.test(fileId)) {
      throw new AppError("Invalid stored file ID", "VALIDATION_ERROR", 400);
    }
    const ledger = await getLiveLedger(userId);
    const read = ledger == null ? null : await streamAuthorizedFile(ledger.id, fileId);
    if (read == null) throw new AppError("Stored file not found", "FILE_NOT_FOUND", 404);
    return new NextResponse(read.body, {
      status: 200,
      headers: {
        "Content-Type": read.file.metadata.contentType,
        "Content-Length": String(read.file.metadata.byteSize),
        "Cache-Control": CACHE_CONTROL,
        "X-Content-Type-Options": "nosniff",
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    const status = getErrorStatusCode(error);
    const body = toSanitizedErrorResponse(error);
    logger[status < 500 ? "warn" : "error"](
      { requestId, status, errorCode: body.error.code },
      status < 500 ? "Stored file request rejected" : "Stored file request failed"
    );
    return NextResponse.json(body, {
      status,
      headers: { "Cache-Control": CACHE_CONTROL, "X-Request-Id": requestId },
    });
  }
}
