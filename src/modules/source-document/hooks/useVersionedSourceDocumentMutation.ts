"use client";

import type { UseLedgerMutationOptions } from "@/lib/mutations/use-ledger-mutation";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import type { VersionedCommandResult } from "@/modules/source-document/contracts";
import {
  requireSourceDocumentVersion,
  unwrapVersionedCommandResult,
} from "@/modules/source-document/command-results";

interface UseVersionedSourceDocumentMutationOptions<TResult> {
  refreshMode?: "wait" | "background";
  ledgerId: string | undefined;
  sourceDocumentId: string;
  expectedVersion: number | null;
  action: (
    ledgerId: string,
    sourceDocumentId: string,
    expectedVersion: number
  ) => Promise<VersionedCommandResult<TResult>>;
  successMessage: string;
  errorMessage: string | null;
  onSuccess?: UseLedgerMutationOptions<TResult, void>["onSuccess"];
  onError?: UseLedgerMutationOptions<TResult, void>["onError"];
}

export function useVersionedSourceDocumentMutation<TResult>({
  refreshMode = "wait",
  ledgerId,
  sourceDocumentId,
  expectedVersion,
  action,
  successMessage,
  errorMessage,
  onSuccess,
  onError,
}: UseVersionedSourceDocumentMutationOptions<TResult>) {
  return useLedgerMutation<TResult, void | (() => void)>(ledgerId, {
    refreshMode,
    invalidates: ["documents", "stats"],
    mutationFn: async () => {
      if (ledgerId == null || ledgerId === "") throw new Error("No ledger ID");
      const version = requireSourceDocumentVersion(expectedVersion, sourceDocumentId);
      const result = await action(ledgerId, sourceDocumentId, version);
      return unwrapVersionedCommandResult(result);
    },
    successMessage,
    errorMessage,
    onSuccess: (result, onCommitted) => {
      onCommitted?.();
      return onSuccess?.(result, undefined);
    },
    ...(onError === undefined ? {} : { onError: (error: Error) => onError(error, undefined) }),
  });
}
