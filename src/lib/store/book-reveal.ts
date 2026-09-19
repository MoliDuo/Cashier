"use client";

import { create } from "zustand";

interface BookRevealState {
  /** Whether the pull-down book switcher is showing. */
  open: boolean;
  setOpen: (open: boolean) => void;
}

/**
 * The switcher is one strip, opened only by the pull gesture. It renders above
 * all tabs while the gesture is answered further down the tree, so the open
 * state is shared here rather than drilled through each tab.
 */
export const useBookRevealStore = create<BookRevealState>((set) => ({
  open: false,
  setOpen: (open) => set((state) => (state.open === open ? state : { open })),
}));
