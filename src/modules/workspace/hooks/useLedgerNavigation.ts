"use client";
import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ledgerTabFromPathname, ledgerTabHref, type LedgerTab } from "@/lib/ledger-tabs";
import { readLedgerDetailParam } from "@/lib/navigation/ledger-detail-navigation";
import { useWorkspaceStore } from "../store";

/**
 * Moves between the ledger's routes. A tab opens on the query it was last left
 * with, so 明细's filters are still there after a look at 统计. Scroll position
 * is each tab's own business (useTabScrollRestoration), not the router's.
 */
export function useLedgerNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const routeQueries = useWorkspaceStore((state) => state.routeQueries);
  const activeTab = ledgerTabFromPathname(pathname);

  const hrefFor = useCallback(
    (tab: LedgerTab) => ledgerTabHref(tab, routeQueries[tab] ?? ""),
    [routeQueries]
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
