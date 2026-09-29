"use client";
import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/modules/workspace/ui/AppShell";
import { LedgerTopBar } from "@/modules/workspace/ui/LedgerTopBar";
import { TabNavigation } from "@/modules/workspace/ui/TabNavigation";
import { preloadNewRecordModules } from "@/modules/workspace/ui/NewRecordForms";
import { useLedgerNavigation } from "@/modules/workspace/hooks/useLedgerNavigation";
import { useTabScrollRestoration } from "@/modules/workspace/hooks/useTabScrollRestoration";
import { useWorkspaceStore } from "@/modules/workspace/store";
import { openNewRecord } from "@/lib/navigation/ledger-new-record-navigation";
import { LEDGER_ROUTES, type LedgerTab } from "@/lib/ledger-tabs";
import { readLedgerFilterParams } from "@/modules/workspace/ledger-url-params";
import { readPeriodParams } from "@/modules/workspace/period-url-params";
import {
  prefetchDetailsTabQuery,
  prefetchStatsTabQuery,
} from "@/modules/workspace/prefetch-ledger-tabs";

/**
 * The bars every ledger route shares. They render outside the layout's data
 * Suspense, so the frame is on screen while the ledger loads; navigation stays
 * disabled until the workspace has mounted, so an early click cannot race its
 * hydration.
 */
export function LedgerShell({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const ready = useWorkspaceStore((state) => state.ready);
  // While a phone selects, its action bar takes the tab bar's place.
  const selecting = useWorkspaceStore((state) => state.headerSelection?.active === true);
  // The viewed book changes on the client with no server render behind it, so
  // the hover prefetch reads it live from the store.
  const bookId = useWorkspaceStore((state) => state.bookId) ?? undefined;
  const { activeTab, hrefFor, navigate, prefetch } = useLedgerNavigation();
  useTabScrollRestoration(activeTab);

  // The routes are dynamic, so a destination the router has not seen waits on
  // the server before it switches. Warming every other route once the ledger
  // is up lets the first tap on each switch at once, to its loading skeleton.
  const warmed = useRef(false);
  useEffect(() => {
    if (!ready || warmed.current) return;
    warmed.current = true;
    for (const tab of LEDGER_ROUTES) if (tab !== activeTab) prefetch(hrefFor(tab));
  }, [activeTab, hrefFor, prefetch, ready]);

  const changeTab = useCallback(
    (tab: LedgerTab) => {
      if (!ready || tab === activeTab) return;
      navigate(tab);
    },
    [activeTab, navigate, ready]
  );

  const preloadTab = useCallback(
    (tab: LedgerTab) => {
      const href = hrefFor(tab);
      prefetch(href);
      const query = new URLSearchParams(href.split("?")[1] ?? "");
      if (tab === "entries") {
        void prefetchDetailsTabQuery(
          queryClient,
          bookId,
          readPeriodParams(query),
          readLedgerFilterParams(query)
        );
      } else if (tab === "stats") {
        void prefetchStatsTabQuery(queryClient, bookId, readPeriodParams(query));
      }
    },
    [bookId, hrefFor, prefetch, queryClient]
  );

  const openInput = openNewRecord;

  return (
    <AppShell
      topBar={
        <LedgerTopBar
          activeTab={activeTab}
          disabled={!ready}
          navigation={
            <TabNavigation
              variant="top"
              disabled={!ready}
              activeTab={activeTab}
              onTabChange={changeTab}
              onTabIntent={preloadTab}
            />
          }
          onOpenInput={openInput}
          onInputIntent={preloadNewRecordModules}
        />
      }
      bottomBar={
        selecting ? null : (
          <TabNavigation
            variant="bottom"
            disabled={!ready}
            activeTab={activeTab}
            onTabChange={changeTab}
            onOpenInput={openInput}
            onInputIntent={preloadNewRecordModules}
            onTabIntent={preloadTab}
          />
        )
      }
    >
      {children}
    </AppShell>
  );
}
