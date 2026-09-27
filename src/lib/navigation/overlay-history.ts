"use client";

import { useEffect, useRef } from "react";

/**
 * Open dialogs as history entries, so the system back gesture — an iPhone's
 * edge swipe — closes the top one instead of leaving the page underneath it.
 *
 * Each open dialog pushes an entry for the same URL, marked with a token and
 * its depth in the stack of open dialogs. Back pops the top entry, and a
 * dialog whose depth is no longer in the history closes. A dialog closed any
 * other way pops its own entry, so Back never lands on a dialog that is gone.
 */
interface OverlayEntry {
  token: string;
  depth: number;
}

function currentOverlay(): OverlayEntry | null {
  const state = window.history.state as { cashierOverlay?: OverlayEntry } | null;
  return state?.cashierOverlay ?? null;
}

/** Whether the current entry is one an open dialog pushed. */
export function isOverlayHistoryEntry(): boolean {
  return currentOverlay() != null;
}

function pushOverlay(token: string): number {
  const depth = (currentOverlay()?.depth ?? 0) + 1;
  // Next keeps its router tree on the entry; carry it so the pop restores the
  // same page without a fetch. The app's own marker comes along too, so a
  // sheet under the dialog still knows it pushed the entry below.
  const state = { ...(window.history.state as Record<string, unknown> | null) };
  window.history.pushState(
    { ...state, cashierOverlay: { token, depth } },
    "",
    window.location.href
  );
  return depth;
}

let nextToken = 0;
// Set while a sheet under open dialogs is leaving in one jump; the dialogs'
// own entries are part of that jump, so none of them pops its own as well.
let leaving = false;
// Backs a closing dialog has asked for that have not landed yet. History moves
// asynchronously, so a jump computed from the current entry has to count them.
let pendingPops = 0;

function popOwnEntry(): void {
  pendingPops += 1;
  const landed = () => {
    window.removeEventListener("popstate", landed);
    pendingPops = Math.max(0, pendingPops - 1);
  };
  window.addEventListener("popstate", landed);
  window.history.back();
}

/**
 * Goes back past every open dialog's entry and `extra` more, in one step, then
 * runs `then` on arrival. A sheet closing with dialogs still stacked on it
 * uses this, so their entries go with it instead of each popping on its own.
 * Returns false, doing nothing, when no dialog entry is on top.
 */
export function leavePastOverlays(extra: number, then?: () => void): boolean {
  const depth = (currentOverlay()?.depth ?? 0) - pendingPops;
  if (depth <= 0) {
    if (pendingPops === 0 || then == null) return false;
    // Only a dialog's own Back is still on its way: act once it has landed,
    // so what `then` writes is not the entry that Back is about to pop.
    const landed = () => {
      window.removeEventListener("popstate", landed);
      then();
    };
    window.addEventListener("popstate", landed);
    return true;
  }
  leaving = true;
  const arrive = () => {
    window.removeEventListener("popstate", arrive);
    leaving = false;
    then?.();
  };
  window.addEventListener("popstate", arrive);
  window.history.go(-(depth + extra));
  return true;
}

/**
 * Ties an open dialog to a history entry. `onClose` is asked to close it when
 * Back pops that entry; a dialog that refuses (it is mid-save, say) simply
 * stays open without one.
 */
export function useOverlayHistory(open: boolean, onClose: () => void, enabled = true): void {
  const tokenRef = useRef<string | null>(null);
  const depthRef = useRef(0);
  const aliveRef = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const active = enabled && open;

  useEffect(() => {
    if (!active) return;
    if (tokenRef.current == null) {
      nextToken += 1;
      tokenRef.current = `overlay-${nextToken}`;
      depthRef.current = pushOverlay(tokenRef.current);
    }
    const token = tokenRef.current;
    const onPopState = () => {
      if ((currentOverlay()?.depth ?? 0) >= depthRef.current) return;
      tokenRef.current = null;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPopState);
    aliveRef.current = true;
    return () => {
      window.removeEventListener("popstate", onPopState);
      aliveRef.current = false;
      // Closed or unmounted by anything but Back: pop the entry it pushed. A
      // development remount runs this and the effect again at once, so the
      // check waits a tick and lets a live dialog keep its entry.
      window.setTimeout(() => {
        if (aliveRef.current || tokenRef.current !== token) return;
        tokenRef.current = null;
        if (leaving) return;
        if (currentOverlay()?.token === token) popOwnEntry();
      }, 0);
    };
  }, [active]);
}
