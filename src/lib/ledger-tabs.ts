/** The ledger's four routes, in navigation order. Each is a page of its own: `/stream`, … */
export const LEDGER_TABS = ["stream", "details", "stats", "settings"] as const;

export type LedgerTab = (typeof LEDGER_TABS)[number];

export function isLedgerTab(value: string | null | undefined): value is LedgerTab {
  return value != null && LEDGER_TABS.includes(value as LedgerTab);
}

/** The tab a ledger pathname shows; anything else falls back to 流水. */
export function ledgerTabFromPathname(pathname: string | null): LedgerTab {
  const segment = pathname?.split("/")[1] ?? "";
  return isLedgerTab(segment) ? segment : "stream";
}

export function ledgerTabHref(tab: LedgerTab, query = ""): string {
  return query === "" ? `/${tab}` : `/${tab}?${query}`;
}
