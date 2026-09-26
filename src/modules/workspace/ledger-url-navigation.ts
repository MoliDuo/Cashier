"use client";
import { writeLedgerHistory, type LedgerNavigationKind } from "@/lib/navigation/ledger-history";
import {
  LEDGER_DETAIL_PARAM,
  readLedgerDetailParam,
} from "@/lib/navigation/ledger-detail-navigation";
import { buildLedgerUrl } from "./ledger-url-params";

type SearchParamsLike = Pick<URLSearchParams, "toString">;

/**
 * Writes a change inside the current route — a filter, a stats period — as a
 * history entry of its own, without a server round trip. Leaving an open
 * detail replaces its entry, so Back cannot reopen the sheet it just closed.
 */
export function pushLedgerUrl(
  pathname: string,
  searchParams: SearchParamsLike | URLSearchParams,
  kind: LedgerNavigationKind
): string {
  const leavingDetail =
    kind !== "detail" && readLedgerDetailParam(new URLSearchParams(window.location.search)) != null;
  const nextSearchParams = new URLSearchParams(searchParams.toString());
  if (kind !== "detail") nextSearchParams.delete(LEDGER_DETAIL_PARAM);
  const url = buildLedgerUrl(pathname, nextSearchParams);
  writeLedgerHistory(leavingDetail ? "replace" : "push", url, kind);
  return url;
}

export function replaceLedgerUrl(
  pathname: string,
  searchParams: SearchParamsLike | URLSearchParams
): string {
  const url = buildLedgerUrl(pathname, searchParams);
  writeLedgerHistory("replace", url, "filter");
  return url;
}
