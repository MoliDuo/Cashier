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
  sourceDocumentId: string;
  input?: SourceDocumentRetryPayload;
  /** The browser's id for this submit, carried to the processing telemetry event. */
  correlationId?: string;
}

export async function retrySourceDocument({
  sourceDocumentId,
  input,
  correlationId,
}: RetrySourceDocumentInput): Promise<RetrySourceDocumentResponseDto> {
  const pending = await submitSourceDocument({
    sourceDocumentId,
    inheritInput: input == null,
    supersedeProcessing: true,
    ...(input == null ? {} : { input }),
  });
  scheduleProcessingAfter(correlationId == null ? pending.job : { ...pending.job, correlationId });
  return { status: "processing" };
}
