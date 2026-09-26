"use client";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { commonCopy } from "@/copy/common";
import { sourceDocumentDetailCopy } from "@/copy/source-document";

interface SaveAndContinueGate {
  confirmOpen: boolean;
  setConfirmOpen: (open: boolean) => void;
  confirmSaveAndContinue: () => Promise<boolean>;
  confirmDiscardAndContinue: () => Promise<boolean>;
}

interface SourceDocumentDetailConfirmDialogsProps {
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
        title={sourceDocumentDetailCopy.batchModePendingTitle}
        description={sourceDocumentDetailCopy.batchModePendingDescription}
        onConfirm={() => setShowBatchModePendingConfirm(false)}
        cancelLabel={commonCopy.cancel}
        onSave={handleSaveAndEnterBatchMode}
        saveLabel={commonCopy.save}
        onDiscard={handleDiscardAndEnterBatchMode}
        discardLabel={sourceDocumentDetailCopy.discardChanges}
      />

      <ConfirmDialog
        open={showBatchDeleteConfirm}
        onOpenChange={setShowBatchDeleteConfirm}
        title={sourceDocumentDetailCopy.batchDeleteTitle}
        description={sourceDocumentDetailCopy.batchDeleteDescription({ count: selectedCount })}
        variant="destructive"
        confirmLabel={commonCopy.delete}
        onConfirm={handleBatchDelete}
      />

      <ConfirmDialog
        open={pendingDeleteEntryId != null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPendingDeleteEntryId(null);
        }}
        title={sourceDocumentDetailCopy.deleteEntryTitle}
        description={sourceDocumentDetailCopy.deleteEntryDescription}
        variant="destructive"
        confirmLabel={commonCopy.delete}
        onConfirm={async () => {
          if (pendingDeleteEntryId == null) return false;
          return handleDeleteEntry(pendingDeleteEntryId);
        }}
      />

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title={commonCopy.delete}
        description={sourceDocumentDetailCopy.deleteConfirmDesc}
        onConfirm={handleDeleteDocument}
        variant="destructive"
        confirmLabel={commonCopy.delete}
      />

      <ConfirmDialog
        open={saveAndContinueGate.confirmOpen}
        onOpenChange={saveAndContinueGate.setConfirmOpen}
        title={sourceDocumentDetailCopy.saveBeforeActionTitle}
        description={sourceDocumentDetailCopy.saveBeforeActionDescription}
        onConfirm={saveAndContinueGate.confirmSaveAndContinue}
        confirmLabel={sourceDocumentDetailCopy.saveAndContinue}
        cancelLabel={commonCopy.continueEditing}
        onDiscard={saveAndContinueGate.confirmDiscardAndContinue}
        discardLabel={sourceDocumentDetailCopy.discardChanges}
      />

      <ConfirmDialog
        open={discardEditsGate.confirmOpen}
        onOpenChange={discardEditsGate.setConfirmOpen}
        title={sourceDocumentDetailCopy.unsavedChanges}
        description={sourceDocumentDetailCopy.unsavedChangesDesc}
        onConfirm={handleConfirmDiscardEdits}
        cancelLabel={commonCopy.continueEditing}
        confirmLabel={sourceDocumentDetailCopy.discardChanges}
        variant="destructive"
      />
    </>
  );
}
