/**
 * The ledger's routes: `/records` (账目), `/stats` (统计) and `/settings`.
 * Only the first two are tabs; 设置 is reached from the gear in the top bar.
 */
export const LEDGER_ROUTES = ["records", "stats", "settings"] as const;

export type LedgerTab = (typeof LEDGER_ROUTES)[number];

/** The routes the navigation bar offers, in order. */
export const NAVIGATION_TABS = ["records", "stats"] as const satisfies readonly LedgerTab[];

/** 账目 shows the same records two ways, named by `?view=`. */
export const RECORDS_VIEWS = ["documents", "entries"] as const;

export type RecordsView = (typeof RECORDS_VIEWS)[number];

export const RECORDS_VIEW_PARAM = "view";

/** What a route shows: 账目 in one of its views, 统计, or 设置. */
export type LedgerPage = RecordsView | "stats" | "settings";

export function isLedgerTab(value: string | null | undefined): value is LedgerTab {
  return value != null && LEDGER_ROUTES.includes(value as LedgerTab);
}

/** The route a ledger pathname shows; anything else falls back to 账目. */
export function ledgerTabFromPathname(pathname: string | null): LedgerTab {
  const segment = pathname?.split("/")[1] ?? "";
  return isLedgerTab(segment) ? segment : "records";
}

/** The view 账目 shows; by bill unless the URL asks for entries. */
export function readRecordsView(params: Pick<URLSearchParams, "get">): RecordsView {
  return params.get(RECORDS_VIEW_PARAM) === "entries" ? "entries" : "documents";
}

export function ledgerPageFor(tab: LedgerTab, params: Pick<URLSearchParams, "get">): LedgerPage {
  return tab === "records" ? readRecordsView(params) : tab;
}

export function ledgerTabHref(tab: LedgerTab, query = ""): string {
  return query === "" ? `/${tab}` : `/${tab}?${query}`;
}
