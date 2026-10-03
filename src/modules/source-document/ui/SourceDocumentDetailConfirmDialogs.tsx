"use client";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { commonCopy } from "@/copy/common";
import { sourceDocumentDetailCopy } from "@/copy/source-document";

interface SourceDocumentDetailConfirmDialogsProps {
  showBatchDeleteConfirm: boolean;
  setShowBatchDeleteConfirm: (open: boolean) => void;
  selectedCount: number;
  handleBatchDelete: () => Promise<boolean>;
  pendingDeleteEntryId: string | null;
  setPendingDeleteEntryId: (id: string | null) => void;
  handleDeleteEntry: (entryId: string) => Promise<boolean>;
  showDeleteConfirm: boolean;
  setShowDeleteConfirm: (open: boolean) => void;
  handleDeleteDocument: () => Promise<void>;
}

/** The detail sheet's destructive confirmations: the record, one entry, or the selection. */
export function SourceDocumentDetailConfirmDialogs({
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
}: SourceDocumentDetailConfirmDialogsProps) {
  return (
    <>
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
        title={sourceDocumentDetailCopy.deleteDocument}
        description={sourceDocumentDetailCopy.deleteConfirmDesc}
        onConfirm={handleDeleteDocument}
        variant="destructive"
        confirmLabel={commonCopy.delete}
      />
    </>
  );
}
