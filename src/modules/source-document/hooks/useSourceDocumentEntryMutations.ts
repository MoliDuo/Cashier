"use client";
import {
  batchDeleteLedgerEntriesAction,
  batchUpdateLedgerEntriesAction,
} from "@/modules/ledger/server-actions/entries";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import { queryKeys } from "@/lib/query-keys";
import type { PartialBatchCommandResult } from "@/modules/source-document/contracts";
import { type BatchEntryUpdateData } from "./source-document-detail-cache";
import {
  requireSourceDocumentVersion,
  unwrapAtomicBatchCommandResult,
} from "@/modules/source-document/command-results";

interface UseSourceDocumentEntryMutationsOptions {
  ledgerId: string | undefined;
  sourceDocumentId: string;
  /** Read fresh at submission time — never captured ahead of the actual click. */
  version: number | null;
}

export function useSourceDocumentEntryMutations({
  ledgerId,
  sourceDocumentId,
  version,
}: UseSourceDocumentEntryMutationsOptions) {
  const batchUpdateMutation = useLedgerMutation<
    { ledgerEntryIds: string[]; affectedCount: number } | undefined,
    { ids: string[]; data: BatchEntryUpdateData }
  >(ledgerId, {
    refreshMode: "background",
    refreshQueryKey: queryKeys.sourceDocument(ledgerId ?? "", sourceDocumentId),
    invalidates: ["documents", "stats"],
    mutationFn: async ({ ids, data }) => {
      if (ledgerId == null || ledgerId === "") return;
      const expectedVersion = requireSourceDocumentVersion(version, sourceDocumentId);
      const { amount, ...rest } = data;
      const result = await batchUpdateLedgerEntriesAction(
        ledgerId,
        [{ sourceDocumentId, expectedVersion }],
        ids,
        {
          ...rest,
          ...(amount == null ? {} : { amount: String(amount) }),
        }
      );
      return unwrapAtomicBatchCommandResult(result);
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
  >(ledgerId, {
    refreshMode: "background",
    refreshQueryKey: queryKeys.sourceDocument(ledgerId ?? "", sourceDocumentId),
    invalidates: ["documents", "stats"],
    mutationFn: async (input) => {
      const entryIds = Array.isArray(input) ? input : input.entryIds;
      if (ledgerId == null || ledgerId === "") throw new Error("No ledger ID");
      const expectedVersion = requireSourceDocumentVersion(version, sourceDocumentId);
      return batchDeleteLedgerEntriesAction(
        ledgerId,
        [{ sourceDocumentId, expectedVersion }],
        entryIds
      );
    },
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
