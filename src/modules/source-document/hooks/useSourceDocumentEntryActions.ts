"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import type { useTranslations } from "next-intl";
import type { LedgerEntry } from "@/modules/ledger/contracts";
import type {
  SourceDocument,
  SplitSourceDocumentInput,
  SplitSourceDocumentResultDto,
} from "@/modules/source-document/contracts";
import { openLedgerDetail } from "@/lib/navigation/ledger-detail-navigation";
import { SourceDocumentStaleCommandError } from "@/modules/source-document/command-results";
import type { AddEntryData } from "./useSourceDocumentDetailMutations";

interface UseSourceDocumentEntryActionsOptions {
  ledgerId: string;
  sourceDocument: SourceDocument | null;
  busy: boolean;
  interactionDisabled: boolean;
  selectedIds: string[];
  ledgerEntries: LedgerEntry[];
  setIsSaving: (saving: boolean) => void;
  setIsSplitting: (splitting: boolean) => void;
  setIsDeleting: (deleting: boolean) => void;
  setShowSplitDialog: (open: boolean) => void;
  setShowAddEntryDialog: (open: boolean) => void;
  setPendingDeleteEntryId: (entryId: string | null) => void;
  clearSelection: () => void;
  onSplit?:
    | ((
        input: Omit<SplitSourceDocumentInput, "sourceDocumentId">
      ) => Promise<SplitSourceDocumentResultDto>)
    | undefined;
  onAddEntry?: ((data: AddEntryData) => Promise<void>) | undefined;
  onDeleteEntry?: ((entryId: string, onCommitted?: () => void) => Promise<void>) | undefined;
  onDelete?: ((onCommitted?: () => void) => void | Promise<void>) | undefined;
  t: ReturnType<typeof useTranslations>;
  tCommon: ReturnType<typeof useTranslations>;
}

/** Owns splitting entries into a new document, adding/deleting a single entry, and deleting the document. */
export function useSourceDocumentEntryActions({
  ledgerId,
  sourceDocument,
  busy,
  interactionDisabled,
  selectedIds,
  ledgerEntries,
  setIsSaving,
  setIsSplitting,
  setIsDeleting,
  setShowSplitDialog,
  setShowAddEntryDialog,
  setPendingDeleteEntryId,
  clearSelection,
  onSplit,
  onAddEntry,
  onDeleteEntry,
  onDelete,
  t,
  tCommon,
}: UseSourceDocumentEntryActionsOptions) {
  const feedbackToastId = `source-document-entry:${ledgerId}:${sourceDocument?.id ?? ""}`;
  const handleOpenSplit = useCallback(() => {
    if (busy || selectedIds.length === 0) return;
    if (selectedIds.length >= ledgerEntries.length) {
      toast.error(t("splitKeepOne"));
      return;
    }
    setShowSplitDialog(true);
  }, [busy, selectedIds, ledgerEntries.length, t, setShowSplitDialog]);

  const handleSplit = useCallback(
    async (entryDate: string) => {
      if (busy) return;
      const expectedVersion = sourceDocument?.version;
      if (expectedVersion == null || onSplit == null) {
        toast.error(t("splitFailed"));
        return;
      }
      setIsSplitting(true);
      try {
        const result = await onSplit({
          expectedVersion,
          ledgerEntryIds: selectedIds,
          entryDate,
        });
        setShowSplitDialog(false);
        clearSelection();
        toast.success(t("splitSuccess", { count: result.movedEntryCount }), {
          id: feedbackToastId,
          action: {
            label: t("viewSplitBill"),
            onClick: () =>
              openLedgerDetail({
                type: "source-document",
                id: result.splitSourceDocumentId,
                ledgerId,
              }),
          },
        });
      } catch (error) {
        toast.error(
          error instanceof SourceDocumentStaleCommandError
            ? t("actionContextChanged")
            : t("splitFailed")
        );
      } finally {
        setIsSplitting(false);
      }
    },
    [
      busy,
      feedbackToastId,
      sourceDocument?.version,
      onSplit,
      t,
      selectedIds,
      setIsSplitting,
      setShowSplitDialog,
      clearSelection,
      ledgerId,
    ]
  );

  const handleOpenAddEntry = useCallback(
    () => setShowAddEntryDialog(true),
    [setShowAddEntryDialog]
  );

  const handleAddEntrySubmit = useCallback(
    async (data: AddEntryData): Promise<boolean> => {
      if (onAddEntry == null || busy) return false;
      setIsSaving(true);
      try {
        await onAddEntry(data);
        toast.success(t("addEntrySuccess"), { id: feedbackToastId, action: null });
        return true;
      } catch (error) {
        toast.error(
          error instanceof SourceDocumentStaleCommandError
            ? t("actionContextChanged")
            : t("addEntryError")
        );
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [onAddEntry, busy, feedbackToastId, setIsSaving, t]
  );

  const handleDeleteEntry = useCallback(
    async (entryId: string): Promise<boolean> => {
      if (onDeleteEntry == null || busy) return false;
      setIsSaving(true);
      try {
        await onDeleteEntry(entryId, () => setPendingDeleteEntryId(null));
        toast.success(tCommon("deleteSuccess"), { id: feedbackToastId, action: null });
        return true;
      } catch (error) {
        toast.error(
          error instanceof SourceDocumentStaleCommandError
            ? t("actionContextChanged")
            : tCommon("deleteFailed")
        );
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [onDeleteEntry, busy, feedbackToastId, setIsSaving, setPendingDeleteEntryId, t, tCommon]
  );

  const handleRequestDeleteEntry = useCallback(
    (entryId: string) => setPendingDeleteEntryId(entryId),
    [setPendingDeleteEntryId]
  );

  const handleDeleteDocument = useCallback(
    async (onCommitted?: () => void) => {
      if (interactionDisabled) return;
      setIsDeleting(true);
      try {
        await onDelete?.(onCommitted);
      } finally {
        setIsDeleting(false);
      }
    },
    [interactionDisabled, setIsDeleting, onDelete]
  );

  return {
    handleOpenSplit,
    handleSplit,
    handleOpenAddEntry,
    handleAddEntrySubmit,
    handleDeleteEntry,
    handleRequestDeleteEntry,
    handleDeleteDocument,
  };
}
