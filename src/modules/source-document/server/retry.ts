import "server-only";
import { scheduleProcessingAfter } from "@/server/processing/schedule";
import type { RetrySourceDocumentResponseDto } from "@/modules/source-document/contracts";
import { submitSourceDocument } from "./submissions";

interface SourceDocumentRetryPayload {
  text: string | null;
  storedFileIds: string[];
  documentDate: string | null;
}

interface RetrySourceDocumentInput {
  ledgerId: string;
  sourceDocumentId: string;
  input?: SourceDocumentRetryPayload;
}

export async function retrySourceDocument({
  ledgerId,
  sourceDocumentId,
  input,
}: RetrySourceDocumentInput): Promise<RetrySourceDocumentResponseDto> {
  const pending = await submitSourceDocument({
    ledgerId,
    sourceDocumentId,
    inheritInput: input == null,
    supersedeProcessing: true,
    ...(input == null ? {} : { input }),
  });
  if (pending.idempotencyReplay !== true) scheduleProcessingAfter(pending.job);
  return { status: "processing" };
}
