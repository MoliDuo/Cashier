"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { SourceDocumentListItemDto } from "@/modules/source-document/contracts";

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
  const t = useTranslations("LedgerEntriesTab");
  const tCommon = useTranslations("Common");
  return (
    <>
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={onDeleteConfirmOpenChange}
        title={t("deleteConfirmTitle")}
        description={t("deleteConfirmDesc")}
        onConfirm={onDeleteConfirm}
        confirmLabel={tCommon("delete")}
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
