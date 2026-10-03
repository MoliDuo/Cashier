import "server-only";
import { requestBackgroundWork } from "@/server/background/wake";
import type { RetrySourceDocumentResponseDto } from "@/modules/source-document/contracts";
import { submitSourceDocument } from "./submissions";

interface SourceDocumentRetryPayload {
  text: string | null;
  storedFileIds: string[];
  documentDate: string | null;
}

interface RetrySourceDocumentInput {
  sourceDocumentId: string;
  input?: SourceDocumentRetryPayload;
}

export async function retrySourceDocument({
  sourceDocumentId,
  input,
}: RetrySourceDocumentInput): Promise<RetrySourceDocumentResponseDto> {
  await submitSourceDocument({
    sourceDocumentId,
    inheritInput: input == null,
    supersedeProcessing: true,
    ...(input == null ? {} : { input }),
  });
  requestBackgroundWork();
  return { status: "processing" };
}
