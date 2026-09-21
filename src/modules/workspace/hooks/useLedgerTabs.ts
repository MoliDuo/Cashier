"use client";
import { useCallback, useMemo } from "react";
import { updateLedgerSearchParams } from "../ledger-url-params";
import { pushLedgerUrl } from "../ledger-url-navigation";
import { parseLedgerTab, type LedgerTab } from "@/lib/ledger-tabs";

interface UseLedgerTabsOptions {
  initialTab?: LedgerTab;
  searchParams: URLSearchParams;
  pathname: string;
}

interface UseLedgerTabsResult {
  activeTab: LedgerTab;
  handleTabChange: (value: string) => void;
}

export function useLedgerTabs({
  initialTab = "stream",
  searchParams,
  pathname,
}: UseLedgerTabsOptions): UseLedgerTabsResult {
  const activeTab = useMemo(
    () => parseLedgerTab(searchParams, initialTab),
    [searchParams, initialTab]
  );

  const handleTabChange = useCallback(
    (value: string) => {
      const params = updateLedgerSearchParams(searchParams, { tab: value });
      pushLedgerUrl(pathname, params, "tab");
    },
    [pathname, searchParams]
  );

  return {
    activeTab,
    handleTabChange,
  };
}
