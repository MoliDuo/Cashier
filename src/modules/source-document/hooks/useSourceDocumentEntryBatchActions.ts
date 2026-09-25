"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import type { useTranslations } from "next-intl";
import type { LedgerEntry } from "@/modules/ledger/contracts";
import type {
  PartialBatchCommandResult,
  SourceDocument,
} from "@/modules/source-document/contracts";

interface UseSourceDocumentEntryBatchActionsOptions {
  busy: boolean;
  sourceDocument: SourceDocument | null;
  ledgerEntries: LedgerEntry[];
  isSelectionMode: boolean;
  isEditMode: boolean;
  hasPendingChanges: boolean;
  selectedIds: string[];
  setSelectionMode: (selecting: boolean) => void;
  setIsEditMode: (editing: boolean) => void;
  setShowBatchModePendingConfirm: (open: boolean) => void;
  setShowBatchDeleteConfirm: (open: boolean) => void;
  setIsSaving: (saving: boolean) => void;
  discardAllChanges: () => void;
  clearSelection: () => void;
  retainSelection: (ids: string[]) => void;
  handleSaveAll: () => Promise<boolean>;
  onBatchUpdate: (
    ids: string[],
    data: {
      categoryId?: string | null;
      currency?: string;
      entryDate?: string;
      description?: string;
    }
  ) => Promise<{ affectedCount: number } | undefined>;
  onBatchDeleteEntries: (
    ids: string[],
    onCommitted?: (result: PartialBatchCommandResult) => void
  ) => Promise<PartialBatchCommandResult>;
  t: ReturnType<typeof useTranslations>;
}

/** Owns entering/leaving batch-selection mode and the batch category/currency/delete mutations. */
export function useSourceDocumentEntryBatchActions({
  busy,
  sourceDocument,
  ledgerEntries,
  isSelectionMode,
  isEditMode,
  hasPendingChanges,
  selectedIds,
  setSelectionMode,
  setIsEditMode,
  setShowBatchModePendingConfirm,
  setShowBatchDeleteConfirm,
  setIsSaving,
  discardAllChanges,
  clearSelection,
  retainSelection,
  handleSaveAll,
  onBatchUpdate,
  onBatchDeleteEntries,
  t,
}: UseSourceDocumentEntryBatchActionsOptions) {
  const enterBatchSelectionMode = useCallback(() => {
    discardAllChanges();
    setIsEditMode(false);
    setSelectionMode(true);
  }, [discardAllChanges, setIsEditMode, setSelectionMode]);

  const handleToggleSelectionMode = useCallback(() => {
    if (busy || sourceDocument == null || ledgerEntries.length === 0) return;
    if (isSelectionMode) {
      setSelectionMode(false);
      return;
    }
    if (!isEditMode || !hasPendingChanges) {
      enterBatchSelectionMode();
      return;
    }
    setShowBatchModePendingConfirm(true);
  }, [
    busy,
    enterBatchSelectionMode,
    hasPendingChanges,
    isEditMode,
    isSelectionMode,
    ledgerEntries.length,
    setSelectionMode,
    setShowBatchModePendingConfirm,
    sourceDocument,
  ]);

  const handleSaveAndEnterBatchMode = useCallback(async () => {
    const saved = await handleSaveAll();
    if (!saved) return false;
    setIsEditMode(false);
    setSelectionMode(true);
    setShowBatchModePendingConfirm(false);
    return true;
  }, [handleSaveAll, setIsEditMode, setSelectionMode, setShowBatchModePendingConfirm]);

  const handleDiscardAndEnterBatchMode = useCallback(() => {
    enterBatchSelectionMode();
    setShowBatchModePendingConfirm(false);
  }, [enterBatchSelectionMode, setShowBatchModePendingConfirm]);

  const performBatchPatch = useCallback(
    async (patch: { categoryId: string | null } | { currency: string }) => {
      if (selectedIds.length === 0 || busy) return;
      setIsSaving(true);
      try {
        const result = await onBatchUpdate(selectedIds, patch);
        const affectedCount = result?.affectedCount ?? 0;
        if (affectedCount > 0) toast.success(t("batchUpdateSuccess", { count: affectedCount }));
        clearSelection();
      } catch {
        toast.error(t("batchUpdateError"));
      } finally {
        setIsSaving(false);
      }
    },
    [selectedIds, busy, setIsSaving, onBatchUpdate, t, clearSelection]
  );

  const performBatchCategory = useCallback(
    (categoryId: string | null) => performBatchPatch({ categoryId }),
    [performBatchPatch]
  );

  const performBatchCurrency = useCallback(
    (currency: string) => performBatchPatch({ currency }),
    [performBatchPatch]
  );

  const handleBatchDelete = useCallback(async () => {
    if (busy) return false;
    setIsSaving(true);
    try {
      const result = await onBatchDeleteEntries(selectedIds, (result) => {
        if (result.failed.length === 0) setShowBatchDeleteConfirm(false);
      });
      const unresolved = result.failed.map((item) => item.id);
      if (unresolved.length === 0) clearSelection();
      else retainSelection(unresolved);
      if (result.succeeded.length > 0) {
        toast.success(t("batchDeleteSuccess", { count: result.succeeded.length }));
      }
      if (unresolved.length > 0) {
        toast.error(t("batchDeletePartial", { count: unresolved.length }));
      }
      if (unresolved.length === 0) setShowBatchDeleteConfirm(false);
      return unresolved.length === 0;
    } catch {
      toast.error(t("batchDeleteError"));
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [
    busy,
    setIsSaving,
    onBatchDeleteEntries,
    selectedIds,
    clearSelection,
    retainSelection,
    t,
    setShowBatchDeleteConfirm,
  ]);

  return {
    handleToggleSelectionMode,
    handleSaveAndEnterBatchMode,
    handleDiscardAndEnterBatchMode,
    performBatchCategory,
    performBatchCurrency,
    handleBatchDelete,
  };
}
