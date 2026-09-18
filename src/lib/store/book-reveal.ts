"use client";

import { create } from "zustand";

interface BookRevealState {
  /** Whether the pull-down book switcher is showing. */
  open: boolean;
  setOpen: (open: boolean) => void;
}

/**
 * The switcher is one strip with two ways in: the pull gesture and the 仅看 X
 * chip (or the 分账 button, in 总账) in a tab's toolbar. They are far apart in
 * the tree — the trigger sits in the tab, the strip above all tabs — so the
 * open state is shared here rather than drilled through each tab.
 */
export const useBookRevealStore = create<BookRevealState>((set) => ({
  open: false,
  setOpen: (open) => set((state) => (state.open === open ? state : { open })),
}));

/**
 * The control that opened the strip, so focus can follow the strip. It stays
 * null for a pull gesture, which is what keeps a wheel or a drag from stealing
 * focus out of whatever the user was doing.
 */
let lastOpener: HTMLElement | null = null;

/** Opens the strip from a toolbar trigger, remembering it for focus. */
export function openBookReveal(opener?: HTMLElement | null): void {
  const active = typeof document === "undefined" ? null : document.activeElement;
  lastOpener =
    opener ?? (active instanceof HTMLElement && active !== document.body ? active : null);
  useBookRevealStore.getState().setOpen(true);
}

/**
 * The trigger's press: the strip opens, and a second press puts it away. Focus
 * is already on the trigger in that second case, so nothing has to move.
 */
export function toggleBookReveal(opener: HTMLElement | null): void {
  const state = useBookRevealStore.getState();
  if (state.open) {
    clearBookRevealTrigger();
    state.setOpen(false);
    return;
  }
  openBookReveal(opener);
}

/** Whether the strip was opened from a control (not a gesture). */
export function hasBookRevealTrigger(): boolean {
  return lastOpener != null;
}

/** Drops the remembered trigger, for a gesture-opened or gesture-closed strip. */
export function clearBookRevealTrigger(): void {
  lastOpener = null;
}

/**
 * Puts focus back on the trigger that opened the strip, if it is still mounted.
 * A trigger that is gone — the chip disappears when a pick widened the scope
 * back to 总账, or the chip appears when one narrowed it — hands over to
 * whichever trigger is on the page now, so the keyboard does not end up on
 * `<body>`.
 */
export function restoreBookRevealFocus(): void {
  const opener = lastOpener;
  lastOpener = null;
  if (opener != null && opener.isConnected) {
    opener.focus();
    return;
  }
  if (typeof document === "undefined") return;
  const fallback = document.querySelector<HTMLElement>(
    '[data-testid="book-scope-chip"], [data-testid="book-scope-trigger"]'
  );
  fallback?.focus();
}
