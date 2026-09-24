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
  VersionedTarget,
} from "@/modules/source-document/contracts";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import {
  requireSourceDocumentVersion,
  SourceDocumentStaleCommandError,
  unwrapAtomicBatchCommandResult,
  unwrapVersionedCommandResult,
} from "@/modules/source-document/command-results";

export function useBatchSourceDocumentActions(
  ledgerId: string,
  clearSelection: () => void,
  retainSelection: ((ids: string[]) => void) | undefined,
  versions: ReadonlyMap<string, number>
) {
  const tCommon = useTranslations("Common");
  const tBatch = useTranslations("BatchActions");
  const versionFor = (sourceDocumentId: string) =>
    requireSourceDocumentVersion(versions.get(sourceDocumentId), sourceDocumentId);
  const deleteSourceDocument = useLedgerMutation<
    void,
    string | { id: string; onCommitted: () => void }
  >(ledgerId, {
    refreshMode: "background",
    invalidates: ["documents", "stats"],
    mutationFn: async (input) => {
      const id = typeof input === "string" ? input : input.id;
      const result = await deleteSourceDocumentAction(ledgerId, id, versionFor(id));
      unwrapVersionedCommandResult(result);
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
  >(ledgerId, {
    refreshMode: "background",
    invalidates: ["documents", "stats"],
    mutationFn: async ({ ids, entryDate }) => {
      const result = await batchUpdateSourceDocumentsAction(ledgerId, {
        targets: ids.map((sourceDocumentId) => ({
          sourceDocumentId,
          expectedVersion: versionFor(sourceDocumentId),
        })),
        data: { documentDate: entryDate },
      });
      return unwrapAtomicBatchCommandResult(result);
    },
    onSuccess: (result) => {
      toast.success(tBatch("datesUpdated", { count: result.updatedCount }));
      clearSelection();
    },
    onError: (error) => {
      toast.error(
        error instanceof SourceDocumentStaleCommandError
          ? tBatch("selectionChanged")
          : tCommon("error")
      );
    },
  });

  const settleBatchResult = (
    result: PartialBatchCommandResult,
    successLabel: string,
    preserveIds: string[] = []
  ) => {
    const unresolved = [...result.stale, ...result.failed].map((item) => item.id);
    const retained = [...new Set([...preserveIds, ...unresolved])];
    if (retained.length === 0) clearSelection();
    else retainSelection?.(retained);
    if (result.succeeded.length > 0) toast.success(successLabel);
    if (unresolved.length > 0) {
      toast.warning(
        tBatch("partialResult", {
          succeeded: result.succeeded.length,
          skipped: result.stale.length,
          failed: result.failed.length,
        })
      );
    }
  };

  const targetsFor = (ids: string[]): VersionedTarget[] =>
    ids.map((sourceDocumentId) => ({
      sourceDocumentId,
      expectedVersion: versionFor(sourceDocumentId),
    }));

  const batchDelete = useLedgerMutation<
    PartialBatchCommandResult,
    string[] | { ids: string[]; onCommitted: () => void }
  >(ledgerId, {
    refreshMode: "background",
    invalidates: ["documents", "stats"],
    mutationFn: (input) =>
      batchDeleteSourceDocumentsAction(
        ledgerId,
        targetsFor(Array.isArray(input) ? input : input.ids)
      ),
    onSuccess: (result, input) => {
      if (!Array.isArray(input) && result.stale.length + result.failed.length === 0)
        input.onCommitted();
      settleBatchResult(result, tBatch("deleted", { count: result.succeeded.length }));
    },
    onError: () => toast.error(tCommon("deleteFailed")),
  });

  const batchRetry = useLedgerMutation<PartialBatchCommandResult, string[]>(ledgerId, {
    refreshMode: "background",
    invalidates: ["documents", "stats"],
    mutationFn: (ids) => batchRetrySourceDocumentsAction(ledgerId, targetsFor(ids)),
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
