"use client";

import { useEffect } from "react";
import type { LedgerTab } from "@/lib/ledger-tabs";
import {
  LEDGER_DETAIL_PARAM,
  readLedgerDetailParam,
} from "@/lib/navigation/ledger-detail-navigation";
import { useModalStackStore } from "@/lib/store/modal-stack";
import { normalizeLedgerFilterSearchParams } from "../ledger-url-params";
import { normalizeStatsSearchParams } from "../stats-url-params";
import { replaceLedgerUrl } from "../ledger-url-navigation";
import { useWorkspaceStore } from "../store";

interface UseLedgerHistorySyncOptions {
  activeTab: LedgerTab;
  pathname: string;
  searchParams: URLSearchParams;
}

/**
 * Keeps the URL canonical, the detail sheets in step with it, and each route's
 * last query remembered. Browser history is never intercepted: unsaved edits
 * survive as drafts instead.
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
        : activeTab === "settings"
          ? null
          : normalizeLedgerFilterSearchParams(searchParams);
    if (next != null) replaceLedgerUrl(pathname, next);
  }, [activeTab, pathname, searchParams]);

  useEffect(() => {
    const query = new URLSearchParams(searchParams.toString());
    query.delete(LEDGER_DETAIL_PARAM);
    rememberRouteQuery(activeTab, query.toString());
  }, [activeTab, rememberRouteQuery, searchParams]);

  useEffect(() => {
    const detailId = readLedgerDetailParam(searchParams);
    useModalStackStore
      .getState()
      .syncToDetail(
        detailId == null ? null : { type: "source-document", id: detailId, returnFocus: null }
      );
  }, [searchParams]);
}
