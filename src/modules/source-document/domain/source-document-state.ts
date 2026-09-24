import {
  supportedSourceDocumentActions,
  type RevisionProcessingStatus,
  type SupportedSourceDocumentAction,
} from "@/modules/source-document/lifecycle";

export function deriveSourceDocumentCapabilities(input: {
  activeRevisionId: string | null;
  latestSubmissionStatus: RevisionProcessingStatus | null;
  hasSubmissionInput: boolean;
}): {
  canEdit: boolean;
  supportedActions: readonly SupportedSourceDocumentAction[];
} {
  const supportedActions = supportedSourceDocumentActions(input);
  return {
    canEdit: input.activeRevisionId != null && input.latestSubmissionStatus !== "processing",
    supportedActions,
  };
}
