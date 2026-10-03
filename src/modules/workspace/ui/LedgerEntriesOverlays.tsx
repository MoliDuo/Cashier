"use client";

import dynamic from "next/dynamic";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { SourceDocumentListItemDto } from "@/modules/source-document/contracts";
import { commonCopy } from "@/copy/common";
import { ledgerEntriesTabCopy } from "@/copy/workspace";

const loadEditRetryDialog = () =>
  import("@/modules/source-document/ui/SourceDocumentEditRetryDialog");

const SourceDocumentEditRetryDialog = dynamic(
  () => loadEditRetryDialog().then((module) => module.SourceDocumentEditRetryDialog),
  { ssr: false }
);

export function preloadEditRetryDialog() {
  void loadEditRetryDialog();
}

interface LedgerEntriesOverlaysProps {
  deleteConfirmOpen: boolean;
  onDeleteConfirmOpenChange: (open: boolean) => void;
  onDeleteConfirm: () => Promise<void>;
  retrySourceDocument: SourceDocumentListItemDto | null;
  onRetryDialogOpenChange: (open: boolean) => void;
}

export function LedgerEntriesOverlays({
  deleteConfirmOpen,
  onDeleteConfirmOpenChange,
  onDeleteConfirm,
  retrySourceDocument,
  onRetryDialogOpenChange,
}: LedgerEntriesOverlaysProps) {
  return (
    <>
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={onDeleteConfirmOpenChange}
        title={ledgerEntriesTabCopy.deleteConfirmTitle}
        description={ledgerEntriesTabCopy.deleteConfirmDesc}
        onConfirm={onDeleteConfirm}
        confirmLabel={commonCopy.delete}
        variant="destructive"
      />

      {retrySourceDocument && (
        <SourceDocumentEditRetryDialog
          sourceDocument={retrySourceDocument}
          open={true}
          onOpenChange={onRetryDialogOpenChange}
        />
      )}
    </>
  );
}
