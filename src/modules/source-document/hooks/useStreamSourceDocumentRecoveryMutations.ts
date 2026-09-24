"use client";

import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslations } from "next-intl";
import { cancelSourceDocumentProcessingAction } from "@/modules/source-document/server-actions/processing";
import { retrySourceDocumentAction } from "@/modules/source-document/server-actions/retry";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import { unwrapVersionedCommandResult } from "@/modules/source-document/command-results";

export interface StreamRecoveryVariables {
  sourceDocumentId: string;
  expectedVersion: number;
}

type RecoveryAction = (variables: StreamRecoveryVariables) => Promise<unknown>;

export function useStreamSourceDocumentRecoveryMutations(ledgerId: string) {
  const tActions = useTranslations("SourceDocumentAction");
  const locksRef = useRef(new Set<string>());
  const [retryingIds, setRetryingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [cancellingIds, setCancellingIds] = useState<ReadonlySet<string>>(() => new Set());

  const updatePending = useCallback(
    (
      setter: Dispatch<SetStateAction<ReadonlySet<string>>>,
      sourceDocumentId: string,
      pending: boolean
    ) => {
      setter((current) => {
        const next = new Set(current);
        if (pending) next.add(sourceDocumentId);
        else next.delete(sourceDocumentId);
        return next;
      });
    },
    []
  );

  const retryMutation = useLedgerMutation<unknown, StreamRecoveryVariables>(ledgerId, {
    invalidates: ["documents", "stats"],
    mutationFn: async ({ sourceDocumentId, expectedVersion }) =>
      unwrapVersionedCommandResult(
        await retrySourceDocumentAction(ledgerId, sourceDocumentId, expectedVersion)
      ),
    successMessage: tActions("retrySuccess"),
    errorMessage: tActions("retryError"),
  });
  const cancelMutation = useLedgerMutation<unknown, StreamRecoveryVariables>(ledgerId, {
    invalidates: ["documents", "stats"],
    mutationFn: async ({ sourceDocumentId, expectedVersion }) =>
      unwrapVersionedCommandResult(
        await cancelSourceDocumentProcessingAction(ledgerId, sourceDocumentId, expectedVersion)
      ),
    successMessage: tActions("cancelSuccess"),
    errorMessage: tActions("cancelError"),
  });
  const retryMutationRef = useRef(retryMutation.mutateAsync);
  const cancelMutationRef = useRef(cancelMutation.mutateAsync);
  retryMutationRef.current = retryMutation.mutateAsync;
  cancelMutationRef.current = cancelMutation.mutateAsync;

  const run = useCallback(
    async (
      variables: StreamRecoveryVariables,
      action: RecoveryAction,
      setter: Dispatch<SetStateAction<ReadonlySet<string>>>
    ) => {
      if (locksRef.current.has(variables.sourceDocumentId)) return;
      locksRef.current.add(variables.sourceDocumentId);
      updatePending(setter, variables.sourceDocumentId, true);
      try {
        await action(variables);
      } catch {
        // The mutation owns user-visible error reporting.
      } finally {
        locksRef.current.delete(variables.sourceDocumentId);
        updatePending(setter, variables.sourceDocumentId, false);
      }
    },
    [updatePending]
  );

  const retry = useCallback(
    (variables: StreamRecoveryVariables) =>
      run(variables, retryMutationRef.current, setRetryingIds),
    [run]
  );
  const cancelProcessing = useCallback(
    (variables: StreamRecoveryVariables) =>
      run(variables, cancelMutationRef.current, setCancellingIds),
    [run]
  );

  return useMemo(
    () => ({
      retryingIds,
      cancellingIds,
      retry,
      cancelProcessing,
    }),
    [cancellingIds, cancelProcessing, retry, retryingIds]
  );
}
