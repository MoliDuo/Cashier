"use client";

import { useCallback } from "react";
import { useSelection } from "@/hooks/use-selection";
import type { SourceDocumentDeferredAction } from "./source-document-deferred-action";
import type { UseSourceDocumentDetailControllerOptions } from "./source-document-detail-controller.types";
import { useSourceDocumentDeferredActions } from "./useSourceDocumentDeferredActions";
import { useSourceDocumentDetailDialogState } from "./useSourceDocumentDetailDialogState";
import { useSourceDocumentDetailSession } from "./useSourceDocumentDetailSession";
import { useSourceDocumentEntryActions } from "./useSourceDocumentEntryActions";
import { useSourceDocumentEntryBatchActions } from "./useSourceDocumentEntryBatchActions";

export function useSourceDocumentDetailController(
  options: UseSourceDocumentDetailControllerOptions
) {
  const { sourceDocument, ledgerEntries, t } = options;
  const selection = useSelection({ allIds: ledgerEntries.map((entry) => entry.id) });
  const session = useSourceDocumentDetailSession({
    sourceDocument,
    ledgerEntries,
    open: options.open,
    externalPending: options.isCancelling,
    onClose: options.onClose,
    onReload: options.onReload,
    onSaveAll: options.onSaveAll,
    clearSelection: selection.clearSelection,
    t,
  });
  const dialogState = useSourceDocumentDetailDialogState();
  const batchActions = useSourceDocumentEntryBatchActions({
    busy: session.busy,
    sourceDocument,
    ledgerEntries,
    isSelectionMode: selection.isSelectionMode,
    isEditMode: session.isEditMode,
    hasPendingChanges: session.pending.hasPendingChanges,
    selectedIds: selection.selectedIds,
    setSelectionMode: selection.setSelectionMode,
    setIsEditMode: session.setIsEditMode,
    setShowBatchModePendingConfirm: dialogState.setShowBatchModePendingConfirm,
    setShowBatchDeleteConfirm: dialogState.setShowBatchDeleteConfirm,
    setIsSaving: session.setIsSaving,
    discardAllChanges: session.pending.discardAllChanges,
    clearSelection: selection.clearSelection,
    retainSelection: selection.retainSelection,
    handleSaveAll: session.handleSaveAll,
    onBatchUpdate: options.onBatchUpdate,
    onBatchDeleteEntries: options.onBatchDeleteEntries,
    t,
  });
  const entryActions = useSourceDocumentEntryActions({
    sourceDocument,
    busy: session.busy,
    interactionDisabled: session.interactionDisabled,
    selectedIds: selection.selectedIds,
    ledgerEntries,
    setIsSaving: session.setIsSaving,
    setIsSplitting: session.setIsSplitting,
    setIsDeleting: session.setIsDeleting,
    setShowSplitDialog: dialogState.setShowSplitDialog,
    setShowAddEntryDialog: dialogState.setShowAddEntryDialog,
    setPendingDeleteEntryId: dialogState.setPendingDeleteEntryId,
    clearSelection: selection.clearSelection,
    onSplit: options.onSplit,
    onAddEntry: options.onAddEntry,
    onDeleteEntry: options.onDeleteEntry,
    onDelete: options.onDelete,
    t,
    tCommon: options.tCommon,
  });

  const executeAction = useCallback(
    async (action: SourceDocumentDeferredAction) => {
      switch (action.type) {
        case "cancel-processing":
          await options.onCancelProcessing?.();
          return;
        case "open-retry":
          dialogState.setShowRetryDialog(true);
          return;
        case "open-delete":
          dialogState.setShowDeleteConfirm(true);
          return;
        case "open-add":
          entryActions.handleOpenAddEntry();
          return;
        case "open-split":
          entryActions.handleOpenSplit();
          return;
        case "request-entry-delete":
          entryActions.handleRequestDeleteEntry(action.entryId);
          return;
        case "batch-delete":
          dialogState.setShowBatchDeleteConfirm(true);
          return;
        case "batch-category":
          await batchActions.performBatchCategory(action.categoryId);
          return;
        case "batch-currency":
          await batchActions.performBatchCurrency(action.currency);
      }
    },
    [batchActions, dialogState, entryActions, options]
  );
  const deferred = useSourceDocumentDeferredActions({
    interactionDisabled: session.interactionDisabled,
    hasVersionConflict: session.revision.hasVersionConflict,
    hasPendingChanges: session.pending.hasPendingChanges,
    saveAll: session.handleSaveAll,
    discardAllChanges: session.pending.discardAllChanges,
    executeAction,
    t,
  });
  const requestAction = deferred.requestAction;

  return {
    editor: {
      ...session.pending,
      isEditMode: session.isEditMode,
      displayTitle: session.pending.pendingChanges.sourceDoc.title ?? sourceDocument?.title ?? "",
      splitInitialDate:
        sourceDocument?.documentDate ?? sourceDocument?.createdAt.slice(0, 10) ?? "",
    },
    selection,
    status: {
      busy: session.busy,
      interactionDisabled: session.interactionDisabled,
      isSaving: session.isSaving,
      isSplitting: session.isSplitting,
      isReloading: session.isReloading,
      reloadError: session.reloadError,
      restoredDraft: session.restoredDraft,
      setIsRetrying: session.setIsRetrying,
    },
    dialogs: {
      ...dialogState,
      discardEditsGate: session.discardEditsGate,
      saveAndContinueGate: deferred.saveAndContinueGate,
    },
    actions: {
      handleClose: session.handleClose,
      handleRequestLeave: session.handleRequestLeave,
      handleEnterEditMode: () => !selection.isSelectionMode && session.handleEnterEditMode(),
      handleCancelEditMode: session.handleCancelEditMode,
      handleEditSave: session.handleEditSave,
      handleConfirmDiscardEdits: session.handleConfirmDiscardEdits,
      handleDiscardDraft: session.handleDiscardDraft,
      handleReload: session.handleReload,
      handleSaveAndEnterBatchMode: batchActions.handleSaveAndEnterBatchMode,
      handleDiscardAndEnterBatchMode: batchActions.handleDiscardAndEnterBatchMode,
      handleToggleSelectionMode: batchActions.handleToggleSelectionMode,
      handleBatchDelete: batchActions.handleBatchDelete,
      ...entryActions,
      handleBatchCategory: (categoryId: string | null) =>
        requestAction({ type: "batch-category", categoryId }),
      handleBatchCurrency: (currency: string) =>
        requestAction({ type: "batch-currency", currency }),
      handleOpenBatchDelete: () => requestAction({ type: "batch-delete" }),
      handleCancelProcessing: () => requestAction({ type: "cancel-processing" }),
      handleOpenRetry: () => requestAction({ type: "open-retry" }),
      handleRequestDelete: () => requestAction({ type: "open-delete" }),
      handleOpenAddEntry: () => requestAction({ type: "open-add" }),
      handleOpenSplit: () => requestAction({ type: "open-split" }),
      handleRequestDeleteEntry: (entryId: string) =>
        requestAction({ type: "request-entry-delete", entryId }),
    },
  };
}
