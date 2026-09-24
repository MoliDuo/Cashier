"use client";

import { useCallback, useRef } from "react";
import { cancelSourceDocumentProcessingAction } from "@/modules/source-document/server-actions/processing";
import { useTranslations } from "next-intl";
import { useVersionedSourceDocumentMutation } from "./useVersionedSourceDocumentMutation";

interface UseSourceDocumentRecoveryMutationsOptions {
  sourceDocumentId: string;
  /** Read fresh at submission time — never captured ahead of the actual click. */
  version: number | null;
  onSuccess?: () => void;
}

/**
 * Cancels a document's processing from its detail view. Cached server data
 * remains unchanged until the action succeeds.
 */
export function useSourceDocumentRecoveryMutations({
  sourceDocumentId,
  version,
  onSuccess,
}: UseSourceDocumentRecoveryMutationsOptions) {
  const actionLockRef = useRef(false);
  const tActions = useTranslations("SourceDocumentAction");

  const cancelMutation = useVersionedSourceDocumentMutation({
    sourceDocumentId,
    expectedVersion: version,
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
