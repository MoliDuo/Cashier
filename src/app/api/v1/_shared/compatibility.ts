import type { SourceDocumentSubmissionContract } from "@/modules/source-document/server/submissions";

export interface ApiV1SourceDocumentCreateResponse {
  sourceDocumentId: string;
  revisionId: string;
  revisionState: "processing";
  status: "processing";
}

export const apiV1Compatibility = {
  version: "v1",
  status: "stable",
} as const;

export function toApiV1SourceDocumentCreateResponse(
  result: SourceDocumentSubmissionContract
): ApiV1SourceDocumentCreateResponse {
  return {
    sourceDocumentId: result.sourceDocumentId,
    revisionId: result.revisionId,
    revisionState: result.processingStatus,
    status: result.processingStatus,
  };
}
