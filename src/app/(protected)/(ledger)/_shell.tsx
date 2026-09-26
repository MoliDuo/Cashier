"use client";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/modules/workspace/ui/AppShell";
import { SwipeTabSurface } from "@/modules/workspace/ui/SwipeTabSurface";
import { TabNavigation } from "@/modules/workspace/ui/TabNavigation";
import { preloadNewRecordModules } from "@/modules/workspace/ui/NewRecordForms";
import { useActiveTabQueryState } from "@/modules/workspace/hooks/useActiveTabQueryState";
import { useLedgerNavigation } from "@/modules/workspace/hooks/useLedgerNavigation";
import { useTabScrollRestoration } from "@/modules/workspace/hooks/useTabScrollRestoration";
import { useWorkspaceStore } from "@/modules/workspace/store";
import type { LedgerTab } from "@/lib/ledger-tabs";
import { parsePeriodFromSearchParams } from "@/lib/period-utils";
import { readLedgerFilterParams } from "@/modules/workspace/ledger-url-params";
import { readStatsSearchParams } from "@/modules/workspace/stats-url-params";
import {
  prefetchDetailsTabQuery,
  prefetchStatsTabQuery,
} from "@/modules/workspace/prefetch-ledger-tabs";

/**
 * The header and tab bar every ledger route shares. It renders outside the
 * layout's data Suspense, so the frame is on screen while the ledger loads;
 * navigation stays disabled until the workspace has mounted, so an early click
 * cannot race its hydration.
 */
export function LedgerShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("Common");
  const queryClient = useQueryClient();
  const ready = useWorkspaceStore((state) => state.ready);
  const setNewRecordOpen = useWorkspaceStore((state) => state.setNewRecordOpen);
  // The viewed book changes on the client with no server render behind it, so
  // the hover prefetch reads it live from the store.
  const bookId = useWorkspaceStore((state) => state.bookId) ?? undefined;
  const routeQueries = useWorkspaceStore((state) => state.routeQueries);
  const { activeTab, hrefFor, navigate, prefetch } = useLedgerNavigation();
  useTabScrollRestoration(activeTab);

  // The destination a reader is already on has nowhere to navigate, so it
  // carries the tab's refresh instead: every tab is reloaded from the same
  // gesture, and no tab needs a control of its own for it.
  const { isRefreshing, refreshActiveTab } = useActiveTabQueryState({ activeTab });
  const [refreshPending, setRefreshPending] = useState(false);

  const refreshCurrentTab = useCallback(async () => {
    // A refresh already under way needs no second one.
    if (isRefreshing || refreshPending) return;
    setRefreshPending(true);
    try {
      await refreshActiveTab();
    } catch {
      toast.error(t("refreshFailed"));
    } finally {
      setRefreshPending(false);
    }
  }, [isRefreshing, refreshActiveTab, refreshPending, t]);

  const changeTab = useCallback(
    (tab: LedgerTab) => {
      if (!ready) return;
      if (tab === activeTab) {
        void refreshCurrentTab();
        return;
      }
      navigate(tab);
    },
    [activeTab, navigate, ready, refreshCurrentTab]
  );

  const preloadTab = useCallback(
    (tab: LedgerTab) => {
      prefetch(hrefFor(tab));
      const query = new URLSearchParams(routeQueries[tab] ?? "");
      if (tab === "details") {
        void prefetchDetailsTabQuery(
          queryClient,
          bookId,
          parsePeriodFromSearchParams(query),
          readLedgerFilterParams(query)
        );
      } else if (tab === "stats") {
        void prefetchStatsTabQuery(queryClient, bookId, readStatsSearchParams(query));
      }
    },
    [bookId, hrefFor, prefetch, queryClient, routeQueries]
  );

  const openInput = useCallback(() => setNewRecordOpen(true), [setNewRecordOpen]);

  return (
    <AppShell
      navigation={
        <TabNavigation
          disabled={!ready}
          refreshing={refreshPending}
          activeTab={activeTab}
          onTabChange={changeTab}
          onOpenInput={openInput}
          onInputIntent={preloadNewRecordModules}
          onTabIntent={preloadTab}
        />
      }
    >
      <SwipeTabSurface activeTab={activeTab} onTabChange={changeTab} onTabIntent={preloadTab}>
        {children}
      </SwipeTabSurface>
    </AppShell>
  );
}
