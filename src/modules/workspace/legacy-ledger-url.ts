import { isLedgerTab, ledgerTabHref } from "@/lib/ledger-tabs";
import { LEDGER_FILTER_KEYS } from "./ledger-url-params";

const LEGACY_STATS_KEYS = {
  statsRange: "range",
  statsOffset: "offset",
  statsView: "view",
} as const;

/**
 * Where a bookmark from the single-page ledger lands. That page named the tab
 * in `?tab=` and prefixed each tab's filters (`streamPeriod`, `detailsSearch`);
 * each tab is now its own route with unprefixed names. Anything the old page
 * would not have read is dropped rather than carried along.
 */
export function legacyLedgerHref(searchParams: Pick<URLSearchParams, "get">): string {
  const rawTab = searchParams.get("tab");
  const tab = isLedgerTab(rawTab) ? rawTab : "stream";
  const params = new URLSearchParams();

  if (tab === "stream" || tab === "details") {
    for (const key of LEDGER_FILTER_KEYS) {
      const value = searchParams.get(`${tab}${key[0]!.toUpperCase()}${key.slice(1)}`);
      if (value != null && value !== "") params.set(key, value);
    }
  } else if (tab === "stats") {
    for (const [legacyKey, key] of Object.entries(LEGACY_STATS_KEYS)) {
      const value = searchParams.get(legacyKey);
      if (value != null && value !== "") params.set(key, value);
    }
  }

  const detailId = searchParams.get("detailId");
  if (searchParams.get("detailType") === "source-document" && detailId != null && detailId !== "") {
    params.set("detail", detailId);
  }

  return ledgerTabHref(tab, params.toString());
}
