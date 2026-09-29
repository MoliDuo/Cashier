import { ledgerTabHref } from "@/lib/ledger-tabs";
import { LEDGER_FILTER_KEYS } from "./ledger-url-params";

const LEGACY_STATS_KEYS = {
  statsRange: "range",
  statsOffset: "offset",
  statsView: "view",
} as const;

/** The tabs the single-page ledger named in `?tab=`. */
const LEGACY_TABS = ["stream", "details", "stats", "settings"] as const;
type LegacyTab = (typeof LEGACY_TABS)[number];

/**
 * Where a bookmark from the single-page ledger lands. That page named the tab
 * in `?tab=` and prefixed each tab's filters (`streamPeriod`, `detailsSearch`);
 * 流水 and 明细 are now the routes 账目 and 明细, with unprefixed names. Anything
 * the old page would not have read is dropped rather than carried along.
 */
export function legacyLedgerHref(searchParams: Pick<URLSearchParams, "get">): string {
  const rawTab = searchParams.get("tab");
  const tab: LegacyTab = LEGACY_TABS.includes(rawTab as LegacyTab)
    ? (rawTab as LegacyTab)
    : "stream";
  const params = new URLSearchParams();

  if (tab === "stream" || tab === "details") {
    // The old period names are carried as they were; the route reads them.
    for (const key of [...LEDGER_FILTER_KEYS, "period", "startDate", "endDate"]) {
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

  const route = tab === "stream" ? "records" : tab === "details" ? "entries" : tab;
  return ledgerTabHref(route, params.toString());
}
