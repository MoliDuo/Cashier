"use client";

import type { UseLedgerMutationOptions } from "@/lib/mutations/use-ledger-mutation";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";

interface UseSourceDocumentCommandMutationOptions<TResult> {
  refreshMode?: "wait" | "background";
  sourceDocumentId: string;
  action: (sourceDocumentId: string) => Promise<TResult>;
  successMessage: string;
  errorMessage: string | null;
  onSuccess?: UseLedgerMutationOptions<TResult, void>["onSuccess"];
  onError?: UseLedgerMutationOptions<TResult, void>["onError"];
}

/** Runs a one-document command, calling an optional `onCommitted` once it succeeds. */
export function useSourceDocumentCommandMutation<TResult>({
  refreshMode = "wait",
  sourceDocumentId,
  action,
  successMessage,
  errorMessage,
  onSuccess,
  onError,
}: UseSourceDocumentCommandMutationOptions<TResult>) {
  return useLedgerMutation<TResult, void | (() => void)>({
    refreshMode,
    invalidates: ["documents", "stats"],
    mutationFn: () => action(sourceDocumentId),
    successMessage,
    errorMessage,
    onSuccess: (result, onCommitted) => {
      onCommitted?.();
      return onSuccess?.(result, undefined);
    },
    ...(onError === undefined ? {} : { onError: (error: Error) => onError(error, undefined) }),
  });
}
