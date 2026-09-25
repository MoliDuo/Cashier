"use client";

import { useCallback, useRef } from "react";
import { cancelSourceDocumentProcessingAction } from "@/modules/source-document/server-actions/processing";
import { useTranslations } from "next-intl";
import { useSourceDocumentCommandMutation } from "./useSourceDocumentCommandMutation";

interface UseSourceDocumentRecoveryMutationsOptions {
  sourceDocumentId: string;
  onSuccess?: () => void;
}

/**
 * Cancels a document's processing from its detail view. Cached server data
 * remains unchanged until the action succeeds.
 */
export function useSourceDocumentRecoveryMutations({
  sourceDocumentId,
  onSuccess,
}: UseSourceDocumentRecoveryMutationsOptions) {
  const actionLockRef = useRef(false);
  const tActions = useTranslations("SourceDocumentAction");

  const cancelMutation = useSourceDocumentCommandMutation({
    sourceDocumentId,
    action: cancelSourceDocumentProcessingAction,
    successMessage: tActions("cancelSuccess"),
    errorMessage: tActions("cancelError"),
    onSuccess: () => {
      onSuccess?.();
    },
  });

  const cancelProcessing = useCallback(async () => {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    try {
      await cancelMutation.mutateAsync();
    } finally {
      actionLockRef.current = false;
    }
  }, [cancelMutation]);

  return {
    cancelProcessing,
    isCancelling: cancelMutation.isPending,
  };
}
