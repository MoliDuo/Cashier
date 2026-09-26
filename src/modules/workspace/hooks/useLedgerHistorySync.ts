"use client";

import { useEffect } from "react";
import { normalizeLedgerUrlSearchParams, readLedgerDetailSearchParams } from "../ledger-url-params";
import { replaceLedgerUrl } from "../ledger-url-navigation";
import { useModalStackStore } from "@/lib/store/modal-stack";

interface UseLedgerHistorySyncOptions {
  pathname: string;
  searchParams: URLSearchParams;
}

/**
 * Keeps the URL canonical and the detail sheets in step with it. Browser
 * history is never intercepted: unsaved edits survive as drafts instead.
 */
export function useLedgerHistorySync({
  pathname,
  searchParams,
}: UseLedgerHistorySyncOptions): void {
  useEffect(() => {
    const next = normalizeLedgerUrlSearchParams(searchParams);
    if (next != null && next.toString() !== searchParams.toString()) {
      replaceLedgerUrl(pathname, next);
    }
  }, [pathname, searchParams]);

  useEffect(() => {
    const detail = readLedgerDetailSearchParams(searchParams);
    useModalStackStore.getState().syncToDetail(
      detail == null
        ? null
        : {
            type: detail.detailType,
            id: detail.detailId,
            returnFocus: null,
          }
    );
  }, [searchParams]);
}
