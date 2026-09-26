"use client";

import { useCallback, useEffect, useState } from "react";
import type { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useConfirmGate } from "@/hooks/use-confirm-gate";
import { clearDraft, draftKey, readDraft, writeDraft } from "@/lib/drafts";
import { useLedgerId } from "@/modules/ledger/hooks/useLedgerId";
import type { LedgerEntry } from "@/modules/ledger/contracts";
import type { SourceDocument } from "@/modules/source-document/contracts";
import type { PendingChanges } from "@/modules/source-document/detail-types";
import { SourceDocumentStaleCommandError } from "@/modules/source-document/command-results";
import { usePendingChanges } from "./usePendingChanges";
import { useSourceDocumentRevisionGuard } from "./useSourceDocumentRevisionGuard";

interface UseSourceDocumentDetailSessionOptions {
  sourceDocument: SourceDocument | null;
  ledgerEntries: LedgerEntry[];
  open: boolean;
  externalPending: boolean;
  onClose: () => void;
  onReload?: (() => Promise<void>) | undefined;
  onSaveAll?:
    | ((
        input: { expectedVersion: number; changes: PendingChanges },
        onCommitted?: () => void
      ) => Promise<void>)
    | undefined;
  clearSelection: () => void;
  t: ReturnType<typeof useTranslations>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** A stored edit is only trusted when every field is a plain value. */
function parsePendingChanges(data: unknown): PendingChanges | null {
  if (!isRecord(data) || !isRecord(data.sourceDoc) || !isRecord(data.entries)) return null;
  const isValue = (value: unknown) =>
    value === null || ["string", "number", "boolean"].includes(typeof value);
  if (!Object.values(data.sourceDoc).every((value) => typeof value === "string")) return null;
  for (const entry of Object.values(data.entries)) {
    if (!isRecord(entry) || !Object.values(entry).every(isValue)) return null;
  }
  return data as unknown as PendingChanges;
}

export function useSourceDocumentDetailSession({
  sourceDocument,
  ledgerEntries,
  open,
  externalPending,
  onClose,
  onReload,
  onSaveAll,
  clearSelection,
  t,
}: UseSourceDocumentDetailSessionOptions) {
  const pending = usePendingChanges({ sourceDocument, ledgerEntries });
  const [isEditMode, setIsEditMode] = useState(false);
  const ledgerId = useLedgerId();
  const key =
    ledgerId == null || sourceDocument == null
      ? null
      : draftKey(ledgerId, "source-document", sourceDocument.id);
  // Unsaved edits outlive the sheet: closing it keeps them for this record, and
  // the next opening restores them in edit mode against the version they were
  // made on, so a changed record still refuses them as a conflict.
  const [restoredKey, setRestoredKey] = useState<string | null>(null);
  const [draftBaseVersion, setDraftBaseVersion] = useState<number | null>(null);
  if (open && key != null && restoredKey !== key) {
    setRestoredKey(key);
    const draft = readDraft(key, parsePendingChanges);
    const baseVersion = draft?.basis == null ? NaN : Number(draft.basis);
    if (draft != null && Number.isInteger(baseVersion)) {
      pending.restoreChanges(draft.data);
      setDraftBaseVersion(baseVersion);
      setIsEditMode(true);
    }
  }
  const revision = useSourceDocumentRevisionGuard({
    hasPendingChanges: pending.hasPendingChanges,
    isEditing: isEditMode,
    version: sourceDocument?.version,
    restoredBaseVersion: draftBaseVersion,
  });
  const draftOutdated =
    pending.hasPendingChanges &&
    draftBaseVersion != null &&
    sourceDocument != null &&
    draftBaseVersion !== sourceDocument.version;

  useEffect(() => {
    if (!open || key == null || restoredKey !== key) return;
    if (!pending.hasPendingChanges) {
      clearDraft(key);
      return;
    }
    const baseVersion = revision.baseVersionRef.current ?? sourceDocument?.version;
    writeDraft(key, pending.pendingChanges, baseVersion == null ? null : String(baseVersion));
  }, [
    key,
    open,
    pending.hasPendingChanges,
    pending.pendingChanges,
    restoredKey,
    revision.baseVersionRef,
    sourceDocument?.version,
  ]);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isSplitting, setIsSplitting] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [reloadError, setReloadError] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setIsEditMode(false);
      setRestoredKey(null);
      setDraftBaseVersion(null);
      pending.resetChanges();
    }
  }

  const busy =
    isSaving || isDeleting || isRetrying || isSplitting || isReloading || externalPending;
  const interactionDisabled = busy || sourceDocument == null;
  const discardEditsGate = useConfirmGate<() => void>();

  const handleRequestLeave = useCallback(
    (continueNavigation: () => void) => {
      if (!busy) continueNavigation();
    },
    [busy]
  );

  const handleClose = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  const handleSaveAll = useCallback(async (): Promise<boolean> => {
    if (busy) return false;
    const expectedVersion = revision.baseVersionRef.current ?? sourceDocument?.version;
    if (revision.hasVersionConflict) {
      toast.error(t("saveConflict"));
      return false;
    }
    if (expectedVersion == null || onSaveAll == null) {
      toast.error(t("saveAllFailed"));
      return false;
    }
    setIsSaving(true);
    try {
      const committed = () => {
        pending.discardAllChanges();
        setDraftBaseVersion(null);
        setIsEditMode(false);
      };
      await onSaveAll(
        {
          expectedVersion,
          changes: pending.pendingChanges,
        },
        committed
      );
      committed();
      toast.success(t("saveAllSuccess", { count: pending.pendingChangesCount }));
      return true;
    } catch (error) {
      // Stale is a distinct outcome from a genuine failure: the pending edits
      // are preserved either way (no discardAllChanges above), but the
      // message tells the user their edits are based on outdated data rather
      // than implying the save itself failed.
      toast.error(
        error instanceof SourceDocumentStaleCommandError ? t("saveConflict") : t("saveAllFailed")
      );
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [busy, onSaveAll, pending, revision, sourceDocument?.version, t]);

  const handleReload = useCallback(async () => {
    if (onReload == null || isReloading) return false;
    setIsReloading(true);
    setReloadError(false);
    try {
      await onReload();
      pending.discardAllChanges();
      setDraftBaseVersion(null);
      clearSelection();
      return true;
    } catch {
      setReloadError(true);
      return false;
    } finally {
      setIsReloading(false);
    }
  }, [clearSelection, isReloading, onReload, pending]);

  const handleEnterEditMode = useCallback(() => {
    if (!interactionDisabled) setIsEditMode(true);
  }, [interactionDisabled]);
  const handleCancelEditMode = useCallback(() => {
    if (busy) return;
    const cancel = () => {
      pending.discardAllChanges();
      setDraftBaseVersion(null);
      setIsEditMode(false);
      void handleReload();
    };
    if (pending.hasPendingChanges) discardEditsGate.requestConfirmation(cancel);
    else cancel();
  }, [busy, discardEditsGate, pending, handleReload]);
  const handleEditSave = useCallback(async () => {
    const saved = await handleSaveAll();
    if (saved) setIsEditMode(false);
    return saved;
  }, [handleSaveAll]);
  const handleConfirmDiscardEdits = useCallback(() => {
    discardEditsGate.resolveConfirmation()?.();
  }, [discardEditsGate]);
  /** Drops a restored draft without leaving the sheet. */
  const handleDiscardDraft = useCallback(() => {
    if (busy) return;
    pending.discardAllChanges();
    setDraftBaseVersion(null);
    setIsEditMode(false);
  }, [busy, pending]);

  return {
    pending,
    revision,
    isEditMode,
    setIsEditMode,
    busy,
    interactionDisabled,
    isSaving,
    setIsSaving,
    isDeleting,
    setIsDeleting,
    isRetrying,
    setIsRetrying,
    isSplitting,
    setIsSplitting,
    isReloading,
    reloadError,
    discardEditsGate,
    /** Set while the sheet shows edits restored from an earlier visit. */
    restoredDraft:
      draftBaseVersion != null && pending.hasPendingChanges ? { outdated: draftOutdated } : null,
    handleDiscardDraft,
    handleClose,
    handleRequestLeave,
    handleSaveAll,
    handleReload,
    handleEnterEditMode,
    handleCancelEditMode,
    handleEditSave,
    handleConfirmDiscardEdits,
  };
}
