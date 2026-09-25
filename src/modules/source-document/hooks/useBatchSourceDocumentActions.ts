"use client";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { deleteSourceDocumentAction } from "@/modules/source-document/server-actions/delete";
import { batchUpdateSourceDocumentsAction } from "@/modules/source-document/server-actions/update";
import {
  batchDeleteSourceDocumentsAction,
  batchRetrySourceDocumentsAction,
} from "@/modules/source-document/server-actions/batch";
import type {
  PartialBatchCommandResult,
  BatchUpdateSourceDocumentsResultDto,
} from "@/modules/source-document/contracts";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";

export function useBatchSourceDocumentActions(
  clearSelection: () => void,
  retainSelection: ((ids: string[]) => void) | undefined
) {
  const tCommon = useTranslations("Common");
  const tBatch = useTranslations("BatchActions");
  const deleteSourceDocument = useLedgerMutation<
    void,
    string | { id: string; onCommitted: () => void }
  >({
    refreshMode: "background",
    invalidates: ["documents", "stats"],
    mutationFn: async (input) => {
      await deleteSourceDocumentAction(typeof input === "string" ? input : input.id);
    },
    successMessage: tCommon("deleteSuccess"),
    errorMessage: tCommon("deleteFailed"),
    onSuccess: (_result, input) => {
      if (typeof input !== "string") input.onCommitted();
      clearSelection();
    },
  });

  const batchUpdateDates = useLedgerMutation<
    BatchUpdateSourceDocumentsResultDto,
    { ids: string[]; entryDate: string }
  >({
    refreshMode: "background",
    invalidates: ["documents", "stats"],
    mutationFn: ({ ids, entryDate }) =>
      batchUpdateSourceDocumentsAction({
        sourceDocumentIds: ids,
        data: { documentDate: entryDate },
      }),
    onSuccess: (result) => {
      toast.success(tBatch("datesUpdated", { count: result.updatedCount }));
      clearSelection();
    },
    onError: () => toast.error(tCommon("error")),
  });

  const settleBatchResult = (
    result: PartialBatchCommandResult,
    successLabel: string,
    preserveIds: string[] = []
  ) => {
    const unresolved = result.failed.map((item) => item.id);
    const retained = [...new Set([...preserveIds, ...unresolved])];
    if (retained.length === 0) clearSelection();
    else retainSelection?.(retained);
    if (result.succeeded.length > 0) toast.success(successLabel);
    if (unresolved.length > 0) {
      toast.warning(
        tBatch("partialResult", {
          succeeded: result.succeeded.length,
          failed: result.failed.length,
        })
      );
    }
  };

  const batchDelete = useLedgerMutation<
    PartialBatchCommandResult,
    string[] | { ids: string[]; onCommitted: () => void }
  >({
    refreshMode: "background",
    invalidates: ["documents", "stats"],
    mutationFn: (input) =>
      batchDeleteSourceDocumentsAction(Array.isArray(input) ? input : input.ids),
    onSuccess: (result, input) => {
      if (!Array.isArray(input) && result.failed.length === 0) input.onCommitted();
      settleBatchResult(result, tBatch("deleted", { count: result.succeeded.length }));
    },
    onError: () => toast.error(tCommon("deleteFailed")),
  });

  const batchRetry = useLedgerMutation<PartialBatchCommandResult, string[]>({
    refreshMode: "background",
    invalidates: ["documents", "stats"],
    mutationFn: (ids) => batchRetrySourceDocumentsAction(ids),
    onSuccess: (result) =>
      settleBatchResult(result, tBatch("retried", { count: result.succeeded.length })),
    onError: () => toast.error(tCommon("error")),
  });

  return {
    deleteSourceDocument,
    batchUpdateDates,
    batchDelete,
    batchRetry,
  };
}
