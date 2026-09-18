"use client";

import { create } from "zustand";

interface BookRevealState {
  /** Whether the pull-down book switcher is showing. */
  open: boolean;
  setOpen: (open: boolean) => void;
}

/**
 * The switcher is one strip with two ways in: the pull gesture and the 仅看 X
 * chip in the toolbar. They are far apart in the tree — the chip sits in a tab's
 * toolbar, the strip above all tabs — so the open state is shared here rather
 * than drilled through each tab.
 */
export const useBookRevealStore = create<BookRevealState>((set) => ({
  open: false,
  setOpen: (open) => set((state) => (state.open === open ? state : { open })),
}));

/** Opens the strip from the hint chip. */
export function openBookReveal(): void {
  useBookRevealStore.getState().setOpen(true);
}
