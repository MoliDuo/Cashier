"use client";
import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ledgerTabFromPathname, ledgerTabHref, type LedgerTab } from "@/lib/ledger-tabs";
import { readLedgerDetailParam } from "@/lib/navigation/ledger-detail-navigation";
import { useWorkspaceStore } from "../store";
import { readPeriodParams, writePeriodParams } from "../period-url-params";

/** The routes that read a period; moving between them carries it along. */
const PERIOD_TABS: ReadonlySet<LedgerTab> = new Set(["records", "stats"]);

/**
 * Moves between the ledger's routes. A tab opens on the query it was last left
 * with, so 账目's filters are still there after a look at 统计 — but the period
 * is one for the whole ledger, so it comes along from the route being left.
 * Scroll position is each tab's own business (useTabScrollRestoration).
 */
export function useLedgerNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeQueries = useWorkspaceStore((state) => state.routeQueries);
  const activeTab = ledgerTabFromPathname(pathname);

  const hrefFor = useCallback(
    (tab: LedgerTab) => {
      const remembered = new URLSearchParams(routeQueries[tab] ?? "");
      const query =
        PERIOD_TABS.has(tab) && PERIOD_TABS.has(activeTab)
          ? writePeriodParams(remembered, readPeriodParams(searchParams))
          : remembered;
      return ledgerTabHref(tab, query.toString());
    },
    [activeTab, routeQueries, searchParams]
  );

  const navigate = useCallback(
    (tab: LedgerTab, query?: URLSearchParams) => {
      const href = query == null ? hrefFor(tab) : ledgerTabHref(tab, query.toString());
      // An open detail's history entry is replaced, so Back cannot reopen it.
      if (readLedgerDetailParam(new URLSearchParams(window.location.search)) != null) {
        router.replace(href, { scroll: false });
      } else {
        router.push(href, { scroll: false });
      }
    },
    [hrefFor, router]
  );

  return { activeTab, hrefFor, navigate, prefetch: router.prefetch };
}
