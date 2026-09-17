"use client";

import { create } from "zustand";

interface MemberScopeRevealState {
  /** Whether the pull-down member switch is showing. */
  open: boolean;
  setOpen: (open: boolean) => void;
}

/**
 * The switch is one strip with two ways in: the pull gesture and the 仅看 X chip
 * in the toolbar. They are far apart in the tree — the chip sits in a tab's
 * toolbar, the strip above all three — so the open state is shared here rather
 * than drilled through each tab.
 */
export const useMemberScopeRevealStore = create<MemberScopeRevealState>((set) => ({
  open: false,
  setOpen: (open) => set((state) => (state.open === open ? state : { open })),
}));

/** Opens the strip from the hint chip. */
export function openMemberScopeReveal(): void {
  useMemberScopeRevealStore.getState().setOpen(true);
}
