"use client";
import { writeLedgerHistory, type LedgerNavigationKind } from "@/lib/navigation/ledger-history";
import {
  buildLedgerUrl,
  readLedgerDetailSearchParams,
  setLedgerDetailSearchParams,
} from "./ledger-url-params";

type SearchParamsLike = Pick<URLSearchParams, "toString">;

export function pushLedgerUrl(
  pathname: string,
  searchParams: SearchParamsLike | URLSearchParams,
  kind: LedgerNavigationKind
): string {
  const leavingDetail =
    kind !== "detail" &&
    readLedgerDetailSearchParams(new URLSearchParams(window.location.search)) != null;
  const nextSearchParams =
    kind === "detail"
      ? searchParams
      : setLedgerDetailSearchParams(new URLSearchParams(searchParams.toString()), null);
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
