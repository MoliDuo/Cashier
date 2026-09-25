"use client";
import {
  batchDeleteLedgerEntriesAction,
  batchUpdateLedgerEntriesAction,
} from "@/modules/ledger/server-actions/entries";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import { queryKeys } from "@/lib/query-keys";
import type { PartialBatchCommandResult } from "@/modules/source-document/contracts";
import { type BatchEntryUpdateData } from "./source-document-detail-cache";

interface UseSourceDocumentEntryMutationsOptions {
  sourceDocumentId: string;
}

export function useSourceDocumentEntryMutations({
  sourceDocumentId,
}: UseSourceDocumentEntryMutationsOptions) {
  const batchUpdateMutation = useLedgerMutation<
    { ledgerEntryIds: string[]; affectedCount: number },
    { ids: string[]; data: BatchEntryUpdateData }
  >({
    refreshMode: "background",
    refreshQueryKey: queryKeys.sourceDocument(sourceDocumentId),
    invalidates: ["documents", "stats"],
    mutationFn: ({ ids, data }) => {
      const { amount, ...rest } = data;
      return batchUpdateLedgerEntriesAction([sourceDocumentId], ids, {
        ...rest,
        ...(amount == null ? {} : { amount: String(amount) }),
      });
    },
    errorMessage: null,
  });

  const batchDeleteMutation = useLedgerMutation<
    PartialBatchCommandResult,
    | string[]
    | {
        entryIds: string[];
        onCommitted?: ((result: PartialBatchCommandResult) => void) | undefined;
      }
  >({
    refreshMode: "background",
    refreshQueryKey: queryKeys.sourceDocument(sourceDocumentId),
    invalidates: ["documents", "stats"],
    mutationFn: (input) =>
      batchDeleteLedgerEntriesAction(
        [sourceDocumentId],
        Array.isArray(input) ? input : input.entryIds
      ),
    successMessage: null,
    errorMessage: null,
    onSuccess: (result, input) => {
      if (!Array.isArray(input)) input.onCommitted?.(result);
    },
  });

  return {
    batchUpdateMutation,
    batchDeleteMutation,
  };
}
