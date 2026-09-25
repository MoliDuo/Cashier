import {
  supportedSourceDocumentActions,
  type RevisionProcessingStatus,
  type SupportedSourceDocumentAction,
} from "@/modules/source-document/lifecycle";

/**
 * A record is edited by hand whenever it is not being processed, including one
 * whose first parse failed: its entries belong to the document, not to a parse.
 */
export function deriveSourceDocumentCapabilities(input: {
  latestSubmissionStatus: RevisionProcessingStatus | null;
  hasSubmissionInput: boolean;
}): {
  canEdit: boolean;
  supportedActions: readonly SupportedSourceDocumentAction[];
} {
  const supportedActions = supportedSourceDocumentActions(input);
  return {
    canEdit: input.latestSubmissionStatus !== "processing",
    supportedActions,
  };
}
