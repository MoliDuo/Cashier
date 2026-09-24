"use client";
import { useEffect, useState } from "react";
import { useUnsavedChangesStore } from "@/lib/store/unsaved-changes";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { useLedgerDialogState } from "../ui/useLedgerDialogState";

/** Owns the "new record" dialog's open/mode state and its unsaved-draft leave guard. */
export function useNewRecordDialogState() {
  const { isInputOpen, setIsInputOpen, inputMode, setInputMode, handleInputDialogChange } =
    useLedgerDialogState();
  const [aiPending, setAiPending] = useState(false);
  const [quickPending, setQuickPending] = useState(false);
  const [aiDirty, setAiDirty] = useState(false);
  const [quickDirty, setQuickDirty] = useState(false);
  const isInputSubmitting = aiPending || quickPending;
  const hasInputDraft = aiDirty || quickDirty;

  const setGlobalDirty = useUnsavedChangesStore((state) => state.setDirty);
  useEffect(() => {
    setGlobalDirty("new-record", hasInputDraft);
    return () => setGlobalDirty("new-record", false);
  }, [hasInputDraft, setGlobalDirty]);

  const guard = useUnsavedChangesGuard({
    key: "new-record-navigation",
    hasUnsavedChanges: hasInputDraft,
  });

  const handleDialogOpenChange = (open: boolean) => {
    if (!open && isInputSubmitting) return;
    if (!open && hasInputDraft) {
      guard.requestLeave(null);
      return;
    }
    handleInputDialogChange(open);
  };

  const confirmDiscard = () => {
    const continueNavigation = guard.resolveLeave();
    setIsInputOpen(false);
    setAiDirty(false);
    setQuickDirty(false);
    continueNavigation?.();
  };

  return {
    isInputOpen,
    setIsInputOpen,
    inputMode,
    setInputMode,
    aiPending,
    setAiPending,
    quickPending,
    setQuickPending,
    aiDirty,
    setAiDirty,
    quickDirty,
    setQuickDirty,
    isInputSubmitting,
    hasInputDraft,
    handleDialogOpenChange,
    discardConfirmOpen: guard.confirmOpen,
    setDiscardConfirmOpen: guard.setConfirmOpen,
    confirmDiscard,
  };
}
