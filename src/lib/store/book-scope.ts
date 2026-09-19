"use client";

import { create } from "zustand";

interface BookScopeState {
  /** The book the page is narrowed to, or null for 总账. */
  bookId: string | null;
  setBookId: (bookId: string | null) => void;
}

/**
 * The viewed book, as the shell's hover prefetch needs to see it. The scope is
 * not URL state — it is this device's choice, carried by a cookie — but the
 * prefetcher sits outside the page's tree, so the page publishes each choice
 * here rather than passing it down through every tab.
 *
 * Nothing rendered reads this store: the server has no per-request store, and
 * the page renders from the scope its bootstrap resolved, so hydration always
 * agrees with the server HTML.
 */
export const useBookScopeStore = create<BookScopeState>((set) => ({
  bookId: null,
  setBookId: (bookId) => set((state) => (state.bookId === bookId ? state : { bookId })),
}));
