"use client";
import { useCallback, useEffect, useMemo } from "react";
import type { PeriodParams } from "@/lib/period-utils";
import type { LedgerAdvancedFilters } from "@/modules/workspace/initial-query-state";
import type { UnifiedStreamGroup } from "@/modules/source-document/stream-grouping";
import { useSelection } from "@/hooks/use-selection";
import { useBatchSourceDocumentActions } from "@/modules/source-document/hooks/useBatchSourceDocumentActions";

interface UseLedgerEntriesSelectionOptions {
  streamGroups: UnifiedStreamGroup[];
  periodParams: PeriodParams;
  advancedFilters?: LedgerAdvancedFilters | undefined;
}

/** Owns batch-selection state and the batch source-document mutations it drives. */
export function useLedgerEntriesSelection({
  streamGroups,
  periodParams,
  advancedFilters,
}: UseLedgerEntriesSelectionOptions) {
  const allSourceDocumentIds = useMemo(
    () => streamGroups.flatMap((g) => g.items.map((i) => i.sourceDocument.id)),
    [streamGroups]
  );
  const queryFingerprint = useMemo(
    () =>
      JSON.stringify({
        tab: "stream",
        period: periodParams,
        filters: advancedFilters,
      }),
    [advancedFilters, periodParams]
  );
  const sourceDocumentVersions = useMemo(
    () =>
      new Map(
        streamGroups.flatMap((group) =>
          group.items.map((item) => [item.sourceDocument.id, item.sourceDocument.version] as const)
        )
      ),
    [streamGroups]
  );

  const {
    isSelectionMode,
    toggleSelectionMode,
    selectedIds,
    toggleSelection,
    handleSelectMany,
    selectAll,
    clearSelection,
    retainSelection,
    isAllSelected,
    isSelectionLimitReached,
    selectableCount,
  } = useSelection({ allIds: allSourceDocumentIds, queryFingerprint });

  const { deleteSourceDocument, batchUpdateDates, batchDelete, batchRetry } =
    useBatchSourceDocumentActions(clearSelection, retainSelection, sourceDocumentVersions);
  const selectedEntryIds = useMemo(() => {
    const selected = new Set(selectedIds);
    return [
      ...new Set(
        streamGroups.flatMap((group) =>
          group.items.flatMap((item) =>
            selected.has(item.sourceDocument.id) ? item.ledgerEntries.map((entry) => entry.id) : []
          )
        )
      ),
    ];
  }, [selectedIds, streamGroups]);
  const isBatchPending =
    batchUpdateDates.isPending || batchDelete.isPending || batchRetry.isPending;
  useEffect(() => {
    document.documentElement.dataset.batchSelection = String(isSelectionMode);
    return () => {
      delete document.documentElement.dataset.batchSelection;
    };
  }, [isSelectionMode]);

  const handleToggleSelectionMode = useCallback(() => {
    if (isBatchPending) return;
    toggleSelectionMode();
  }, [isBatchPending, toggleSelectionMode]);

  const handleToggleSelection = useCallback(
    (id: string) => {
      if (!isBatchPending) toggleSelection(id);
    },
    [isBatchPending, toggleSelection]
  );

  const handleSetGroupSelection = useCallback(
    (ids: readonly string[], selected: boolean) => {
      if (!isBatchPending) handleSelectMany(ids, selected);
    },
    [handleSelectMany, isBatchPending]
  );

  const handleBatchUpdateDates = useCallback(
    (date: string, ids: string[]) => batchUpdateDates.mutate({ ids, entryDate: date }),
    [batchUpdateDates]
  );

  return {
    allSourceDocumentIds,
    queryFingerprint,
    isSelectionMode,
    selectedIds,
    selectAll,
    clearSelection,
    isAllSelected,
    isSelectionLimitReached,
    selectableCount,
    deleteSourceDocument,
    batchUpdateDates,
    batchDelete,
    batchRetry,
    selectedEntryIds,
    isBatchPending,
    handleToggleSelectionMode,
    handleToggleSelection,
    handleSetGroupSelection,
    handleBatchUpdateDates,
  };
}
