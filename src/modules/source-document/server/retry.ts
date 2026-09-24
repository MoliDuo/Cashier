import "server-only";
import { StaleSourceDocumentVersionError } from "@/lib/errors";
import { scheduleProcessingAfter } from "@/server/processing/schedule";
import type {
  RetrySourceDocumentResponseDto,
  VersionedCommandResult,
} from "@/modules/source-document/contracts";
import { submitSourceDocument } from "./submissions";
import { staleVersionedCommandResult } from "@/modules/source-document/domain/versioned-command-result";

interface SourceDocumentRetryPayload {
  text: string | null;
  storedFileIds: string[];
  documentDate: string | null;
}

interface RetrySourceDocumentInput {
  ledgerId: string;
  sourceDocumentId: string;
  expectedVersion: number;
  input?: SourceDocumentRetryPayload;
}

export async function retrySourceDocument({
  ledgerId,
  sourceDocumentId,
  expectedVersion,
  input,
}: RetrySourceDocumentInput): Promise<VersionedCommandResult<RetrySourceDocumentResponseDto>> {
  const submission = {
    ledgerId,
    sourceDocumentId,
    expectedVersion,
    inheritInput: input == null,
    supersedeProcessing: true,
    ...(input == null ? {} : { input }),
  };

  let pending;
  try {
    pending = await submitSourceDocument(submission);
  } catch (error) {
    if (error instanceof StaleSourceDocumentVersionError) {
      return staleVersionedCommandResult<RetrySourceDocumentResponseDto>(error);
    }
    throw error;
  }
  if (pending.idempotencyReplay !== true) scheduleProcessingAfter(pending.job);

  return {
    ok: true,
    sourceDocumentId,
    version: pending.document.version,
    data: { status: "processing" as const },
  };
}
