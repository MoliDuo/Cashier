import { type NextRequest, NextResponse } from "next/server";
import { handleApiV1Route } from "@/application/transport/api-v1/request-pipeline";
import { getCredentialSourceDocumentStatus } from "@/modules/source-document/server/credential-status";
import { sourceDocumentIdSchema } from "@/modules/source-document/contract-schemas";
import { NotFoundError } from "@/lib/errors";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sourceDocumentId: string }> }
) {
  return handleApiV1Route(request, {
    logContext: "api/v1/source-documents/[sourceDocumentId]",
    handler: async ({ credential }) => {
      const { sourceDocumentId: rawId } = await context.params;
      const parsed = sourceDocumentIdSchema.safeParse(rawId);
      if (!parsed.success) throw new NotFoundError("Source document");
      const status = await getCredentialSourceDocumentStatus(credential.ledgerId, parsed.data);
      if (status == null) throw new NotFoundError("Source document");
      const response = NextResponse.json(status);
      if (status.status === "processing") response.headers.set("Retry-After", "5");
      return { response };
    },
  });
}
