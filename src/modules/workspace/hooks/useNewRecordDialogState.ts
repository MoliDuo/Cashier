"use client";
import { useState } from "react";
import type { NewRecordInputMode } from "../ui/new-record-success-feedback";
import { useWorkspaceStore } from "../store";

/**
 * Owns the "new record" dialog's open/mode state. Closing it never asks: each
 * form keeps its unsaved input as a draft and restores it on the next opening.
 */
export function useNewRecordDialogState() {
  // The shell's + button opens it from outside the page, so the open flag is shared.
  const isInputOpen = useWorkspaceStore((state) => state.newRecordOpen);
  const setIsInputOpen = useWorkspaceStore((state) => state.setNewRecordOpen);
  const [inputMode, setInputMode] = useState<NewRecordInputMode>("ai");
  const [aiPending, setAiPending] = useState(false);
  const [quickPending, setQuickPending] = useState(false);
  const [aiDirty, setAiDirty] = useState(false);
  const [quickDirty, setQuickDirty] = useState(false);
  const isInputSubmitting = aiPending || quickPending;

  const handleDialogOpenChange = (open: boolean) => {
    if (!open && isInputSubmitting) return;
    setIsInputOpen(open);
  };

  return {
    isInputOpen,
    setIsInputOpen,
    inputMode,
    setInputMode,
    setAiPending,
    setQuickPending,
    aiDirty,
    setAiDirty,
    quickDirty,
    setQuickDirty,
    isInputSubmitting,
    handleDialogOpenChange,
  };
}
