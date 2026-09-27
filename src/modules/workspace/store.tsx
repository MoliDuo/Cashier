"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import type { LedgerTab } from "@/lib/ledger-tabs";

interface WorkspaceState {
  /** False until the ledger's content has mounted; the navigation waits for it. */
  ready: boolean;
  setReady: (ready: boolean) => void;
  /**
   * The book the reader picked, or null for 总账. It is this device's choice,
   * remembered by a cookie, not URL state — so it survives moving between routes.
   */
  bookId: string | null;
  setBookId: (bookId: string | null) => void;
  newRecordOpen: boolean;
  setNewRecordOpen: (open: boolean) => void;
  /** Each route's last query, so returning to a tab returns to its filters. */
  routeQueries: Partial<Record<LedgerTab, string>>;
  rememberRouteQuery: (tab: LedgerTab, query: string) => void;
  /** The tab 设置 was opened from, which its back arrow returns to. */
  lastBrowsedTab: BrowsedTab;
}

type BrowsedTab = Exclude<LedgerTab, "settings">;

type WorkspaceStore = StoreApi<WorkspaceState>;

function createWorkspaceStore(initialBookId: string | null): WorkspaceStore {
  return createStore<WorkspaceState>((set) => ({
    ready: false,
    setReady: (ready) => set({ ready }),
    bookId: initialBookId,
    setBookId: (bookId) => set((state) => (state.bookId === bookId ? state : { bookId })),
    newRecordOpen: false,
    setNewRecordOpen: (newRecordOpen) => set({ newRecordOpen }),
    routeQueries: {},
    rememberRouteQuery: (tab, query) =>
      set((state) => {
        const lastBrowsedTab = tab === "settings" ? state.lastBrowsedTab : tab;
        return state.routeQueries[tab] === query && state.lastBrowsedTab === lastBrowsedTab
          ? state
          : { routeQueries: { ...state.routeQueries, [tab]: query }, lastBrowsedTab };
      }),
    lastBrowsedTab: "records",
  }));
}

const WorkspaceStoreContext = createContext<WorkspaceStore | null>(null);

/**
 * The state the ledger's routes share. One store per layout instance rather
 * than a module singleton, so the server render and the hydrating client start
 * from the same book — the one the request's cookie named.
 */
export function WorkspaceStoreProvider({
  initialBookId,
  children,
}: {
  initialBookId: string | null;
  children: ReactNode;
}) {
  const [store] = useState(() => createWorkspaceStore(initialBookId));
  return <WorkspaceStoreContext.Provider value={store}>{children}</WorkspaceStoreContext.Provider>;
}

export function useWorkspaceStore<T>(selector: (state: WorkspaceState) => T): T {
  const store = useContext(WorkspaceStoreContext);
  if (store == null)
    throw new Error("useWorkspaceStore must be used within WorkspaceStoreProvider");
  return useStore(store, selector);
}
