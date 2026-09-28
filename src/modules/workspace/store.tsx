"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
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
  /** Each route's last query, so returning to a tab returns to its filters. */
  routeQueries: Partial<Record<LedgerTab, string>>;
  rememberRouteQuery: (tab: LedgerTab, query: string) => void;
  /** The tab 设置 was opened from, which its back arrow returns to. */
  lastBrowsedTab: BrowsedTab;
  /**
   * The list on screen as a phone's top bar prints it between the book and the
   * gear, or null when no list is being browsed. Taking it down also folds the
   * list's controls back up.
   */
  headerSummary: HeaderSummary | null;
  setHeaderSummary: (summary: HeaderSummary | null) => void;
  /** Whether a phone's list controls hang open under the top bar. */
  listControlsOpen: boolean;
  setListControlsOpen: (open: boolean) => void;
}

export interface HeaderSummary {
  /** The list's total, or null until it has loaded. */
  total: string | null;
  /** The days the list covers. */
  period: string;
  /** Whether the filter narrows the list beyond the period. */
  filtered: boolean;
}

function sameSummary(a: HeaderSummary | null, b: HeaderSummary | null): boolean {
  if (a == null || b == null) return a === b;
  return a.total === b.total && a.period === b.period && a.filtered === b.filtered;
}

type BrowsedTab = Exclude<LedgerTab, "settings">;

type WorkspaceStore = StoreApi<WorkspaceState>;

function createWorkspaceStore(initialBookId: string | null): WorkspaceStore {
  return createStore<WorkspaceState>((set) => ({
    ready: false,
    setReady: (ready) => set({ ready }),
    bookId: initialBookId,
    setBookId: (bookId) => set((state) => (state.bookId === bookId ? state : { bookId })),
    routeQueries: {},
    rememberRouteQuery: (tab, query) =>
      set((state) => {
        const lastBrowsedTab = tab === "settings" ? state.lastBrowsedTab : tab;
        return state.routeQueries[tab] === query && state.lastBrowsedTab === lastBrowsedTab
          ? state
          : { routeQueries: { ...state.routeQueries, [tab]: query }, lastBrowsedTab };
      }),
    lastBrowsedTab: "records",
    headerSummary: null,
    setHeaderSummary: (headerSummary) =>
      set((state) => {
        if (sameSummary(state.headerSummary, headerSummary)) return state;
        return headerSummary == null
          ? { headerSummary, listControlsOpen: false }
          : { headerSummary };
      }),
    listControlsOpen: false,
    setListControlsOpen: (listControlsOpen) =>
      set((state) =>
        state.listControlsOpen === listControlsOpen ||
        (listControlsOpen && state.headerSummary == null)
          ? state
          : { listControlsOpen }
      ),
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

/**
 * Puts a list's summary in the top bar for as long as the list is browsed, and
 * takes it down when the list leaves or turns to selecting; returns whether a
 * phone has its controls dropped down, and how to fold them. Outside the
 * ledger's routes there is no top bar, so there the controls stay put.
 */
export function useHeaderSummary(summary: HeaderSummary | null): {
  open: boolean;
  close: () => void;
} {
  const store = useContext(WorkspaceStoreContext);
  const total = summary?.total ?? null;
  const period = summary?.period;
  const filtered = summary?.filtered ?? false;
  useEffect(() => {
    if (store == null) return;
    store.getState().setHeaderSummary(period == null ? null : { total, period, filtered });
  }, [store, total, period, filtered]);
  useEffect(() => {
    if (store == null) return;
    return () => store.getState().setHeaderSummary(null);
  }, [store]);
  const open = useSyncExternalStore(
    store?.subscribe ?? noSubscription,
    () => store?.getState().listControlsOpen ?? false,
    () => false
  );
  const close = useCallback(() => store?.getState().setListControlsOpen(false), [store]);
  return { open, close };
}

const noSubscription = () => () => {};
