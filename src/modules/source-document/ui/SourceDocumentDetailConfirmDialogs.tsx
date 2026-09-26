"use client";
import type { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface SaveAndContinueGate {
  confirmOpen: boolean;
  setConfirmOpen: (open: boolean) => void;
  confirmSaveAndContinue: () => Promise<boolean>;
  confirmDiscardAndContinue: () => Promise<boolean>;
}

interface SourceDocumentDetailConfirmDialogsProps {
  t: ReturnType<typeof useTranslations>;
  tCommon: ReturnType<typeof useTranslations>;
  showBatchModePendingConfirm: boolean;
  setShowBatchModePendingConfirm: (open: boolean) => void;
  handleSaveAndEnterBatchMode: () => Promise<boolean>;
  handleDiscardAndEnterBatchMode: () => void;
  showBatchDeleteConfirm: boolean;
  setShowBatchDeleteConfirm: (open: boolean) => void;
  selectedCount: number;
  handleBatchDelete: () => Promise<void | boolean>;
  pendingDeleteEntryId: string | null;
  setPendingDeleteEntryId: (id: string | null) => void;
  handleDeleteEntry: (entryId: string) => Promise<boolean>;
  showDeleteConfirm: boolean;
  setShowDeleteConfirm: (open: boolean) => void;
  handleDeleteDocument: (onCommitted?: () => void) => Promise<void>;
  saveAndContinueGate: SaveAndContinueGate;
  discardEditsGate: { confirmOpen: boolean; setConfirmOpen: (open: boolean) => void };
  handleConfirmDiscardEdits: () => void;
}

/** The six confirm/discard dialogs shared across the detail modal's edit, batch, and close flows. */
export function SourceDocumentDetailConfirmDialogs({
  t,
  tCommon,
  showBatchModePendingConfirm,
  setShowBatchModePendingConfirm,
  handleSaveAndEnterBatchMode,
  handleDiscardAndEnterBatchMode,
  showBatchDeleteConfirm,
  setShowBatchDeleteConfirm,
  selectedCount,
  handleBatchDelete,
  pendingDeleteEntryId,
  setPendingDeleteEntryId,
  handleDeleteEntry,
  showDeleteConfirm,
  setShowDeleteConfirm,
  handleDeleteDocument,
  saveAndContinueGate,
  discardEditsGate,
  handleConfirmDiscardEdits,
}: SourceDocumentDetailConfirmDialogsProps) {
  return (
    <>
      <ConfirmDialog
        open={showBatchModePendingConfirm}
        onOpenChange={setShowBatchModePendingConfirm}
        title={t("batchModePendingTitle")}
        description={t("batchModePendingDescription")}
        onConfirm={() => setShowBatchModePendingConfirm(false)}
        cancelLabel={tCommon("cancel")}
        onSave={handleSaveAndEnterBatchMode}
        saveLabel={tCommon("save")}
        onDiscard={handleDiscardAndEnterBatchMode}
        discardLabel={t("discardChanges")}
      />

      <ConfirmDialog
        open={showBatchDeleteConfirm}
        onOpenChange={setShowBatchDeleteConfirm}
        title={t("batchDeleteTitle")}
        description={t("batchDeleteDescription", { count: selectedCount })}
        variant="destructive"
        confirmLabel={tCommon("delete")}
        onConfirm={handleBatchDelete}
      />

      <ConfirmDialog
        open={pendingDeleteEntryId != null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPendingDeleteEntryId(null);
        }}
        title={t("deleteEntryTitle")}
        description={t("deleteEntryDescription")}
        variant="destructive"
        confirmLabel={tCommon("delete")}
        onConfirm={async () => {
          if (pendingDeleteEntryId == null) return false;
          return handleDeleteEntry(pendingDeleteEntryId);
        }}
      />

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title={tCommon("delete")}
        description={t("deleteConfirmDesc")}
        onConfirm={handleDeleteDocument}
        variant="destructive"
        confirmLabel={tCommon("delete")}
      />

      <ConfirmDialog
        open={saveAndContinueGate.confirmOpen}
        onOpenChange={saveAndContinueGate.setConfirmOpen}
        title={t("saveBeforeActionTitle")}
        description={t("saveBeforeActionDescription")}
        onConfirm={saveAndContinueGate.confirmSaveAndContinue}
        confirmLabel={t("saveAndContinue")}
        cancelLabel={tCommon("continueEditing")}
        onDiscard={saveAndContinueGate.confirmDiscardAndContinue}
        discardLabel={t("discardChanges")}
      />

      <ConfirmDialog
        open={discardEditsGate.confirmOpen}
        onOpenChange={discardEditsGate.setConfirmOpen}
        title={t("unsavedChanges")}
        description={t("unsavedChangesDesc")}
        onConfirm={handleConfirmDiscardEdits}
        cancelLabel={tCommon("continueEditing")}
        confirmLabel={t("discardChanges")}
        variant="destructive"
      />
    </>
  );
}
