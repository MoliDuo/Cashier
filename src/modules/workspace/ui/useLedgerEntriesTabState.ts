"use client";
import { useCallback, useState } from "react";
import type { SourceDocument } from "@/modules/source-document/contracts";

export interface LedgerEntriesDeleteConfirmState {
  open: boolean;
  type: "sourceDocument" | null;
  id: string | null;
  title: string;
  description: string;
}

const EMPTY_DELETE_CONFIRM: LedgerEntriesDeleteConfirmState = {
  open: false,
  type: null,
  id: null,
  title: "",
  description: "",
};

export function useLedgerEntriesTabState() {
  const [deleteConfirm, setDeleteConfirm] =
    useState<LedgerEntriesDeleteConfirmState>(EMPTY_DELETE_CONFIRM);
  const [retrySourceDocument, setRetrySourceDocument] = useState<SourceDocument | null>(null);

  const openSourceDocumentDeleteConfirm = useCallback(
    (id: string, title: string, description: string) => {
      setDeleteConfirm({
        open: true,
        type: "sourceDocument",
        id,
        title,
        description,
      });
    },
    []
  );

  const closeDeleteConfirm = useCallback(() => {
    setDeleteConfirm((prev) => ({ ...prev, open: false }));
  }, []);

  const closeRetrySourceDocument = useCallback(() => {
    setRetrySourceDocument(null);
  }, []);

  return {
    deleteConfirm,
    setDeleteConfirm,
    retrySourceDocument,
    setRetrySourceDocument,
    openSourceDocumentDeleteConfirm,
    closeDeleteConfirm,
    closeRetrySourceDocument,
  };
}
