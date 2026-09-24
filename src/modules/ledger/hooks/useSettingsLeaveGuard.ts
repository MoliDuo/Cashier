"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useUnsavedChangesStore, type UnsavedChangesLeaveGuard } from "@/lib/store/unsaved-changes";

export function useSettingsLeaveGuard() {
  const hasDirtyChanges = useUnsavedChangesStore((state) =>
    [...state.dirtyKeys].some((key) => key.startsWith("settings:"))
  );
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const continueNavigationRef = useRef<(() => void) | null>(null);

  const requestLeave = useCallback((continueNavigation: () => void) => {
    continueNavigationRef.current = continueNavigation;
    setLeaveConfirmOpen(true);
  }, []);

  const attemptLeave = useCallback(
    (continueNavigation: () => void) => {
      if (!hasDirtyChanges) {
        continueNavigation();
        return;
      }
      requestLeave(continueNavigation);
    },
    [hasDirtyChanges, requestLeave]
  );

  const confirmLeave = useCallback(() => {
    const continueNavigation = continueNavigationRef.current;
    continueNavigationRef.current = null;
    setLeaveConfirmOpen(false);
    continueNavigation?.();
  }, []);

  const cancelLeave = useCallback(() => {
    continueNavigationRef.current = null;
    setLeaveConfirmOpen(false);
  }, []);

  useEffect(() => {
    const key = "settings-navigation";
    if (!hasDirtyChanges) {
      useUnsavedChangesStore.getState().registerLeaveGuard(key, null);
      return;
    }
    const guard: UnsavedChangesLeaveGuard = { requestLeave };
    useUnsavedChangesStore.getState().registerLeaveGuard(key, guard);
    return () => useUnsavedChangesStore.getState().registerLeaveGuard(key, null);
  }, [hasDirtyChanges, requestLeave]);

  useEffect(() => {
    if (!hasDirtyChanges) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [hasDirtyChanges]);

  return {
    hasDirtyChanges,
    leaveConfirmOpen,
    cancelLeave,
    attemptLeave,
    confirmLeave,
  };
}
