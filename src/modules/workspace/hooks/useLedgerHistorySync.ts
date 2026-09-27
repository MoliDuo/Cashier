"use client";

import { useEffect } from "react";
import type { LedgerTab } from "@/lib/ledger-tabs";
import { LEDGER_DETAIL_PARAM } from "@/lib/navigation/ledger-detail-navigation";
import { normalizePeriodSearchParams } from "../period-url-params";
import { normalizeStatsSearchParams } from "../stats-url-params";
import { replaceLedgerUrl } from "../ledger-url-navigation";
import { useWorkspaceStore } from "../store";

interface UseLedgerHistorySyncOptions {
  activeTab: LedgerTab;
  pathname: string;
  searchParams: URLSearchParams;
}

/**
 * Keeps the URL canonical and each route's last query remembered. Browser
 * history is never intercepted: unsaved edits survive as drafts instead.
 */
export function useLedgerHistorySync({
  activeTab,
  pathname,
  searchParams,
}: UseLedgerHistorySyncOptions): void {
  const rememberRouteQuery = useWorkspaceStore((state) => state.rememberRouteQuery);

  useEffect(() => {
    const next =
      activeTab === "stats"
        ? normalizeStatsSearchParams(searchParams)
        : activeTab === "records"
          ? normalizePeriodSearchParams(searchParams)
          : null;
    if (next != null) replaceLedgerUrl(pathname, next);
  }, [activeTab, pathname, searchParams]);

  useEffect(() => {
    const query = new URLSearchParams(searchParams.toString());
    query.delete(LEDGER_DETAIL_PARAM);
    rememberRouteQuery(activeTab, query.toString());
  }, [activeTab, rememberRouteQuery, searchParams]);
}
