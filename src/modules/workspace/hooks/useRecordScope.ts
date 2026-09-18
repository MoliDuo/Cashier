"use client";

import { useCallback, useEffect } from "react";
import type { BookDto } from "@/modules/ledger/contracts";
import type { RecordScope } from "@/modules/ledger/filters";
import { resolveLiveRecordScope } from "../record-scope";
import { readRecordScopeSearchParams, setRecordScopeSearchParams } from "../ledger-url-params";
import { pushLedgerUrl, replaceLedgerUrl } from "../ledger-url-navigation";

interface UseRecordScopeOptions {
  /** The live books the scope is validated against; undefined while loading. */
  books: readonly BookDto[] | undefined;
  searchParams: URLSearchParams;
  pathname: string;
  locale: string;
}

interface UseRecordScopeResult {
  /** The book the page is showing, or null for 总账. */
  recordScope: RecordScope;
  onRecordScopeChange: (scope: RecordScope) => void;
}

/**
 * The page's book scope, carried in the URL because the server prefetches with
 * it and the tab-hover prefetch reads it back. Selecting a book is a history
 * entry of its own, so Back returns to the previous scope the way it returns to
 * the previous tab.
 *
 * A selected book can be archived or deleted while it is the scope — 设置 is one
 * tab away. Once the live list says it is gone, the scope falls back to 总账 and
 * the dead id leaves the URL with a replace, so a reload or a share cannot
 * restore it. The list is undefined while it loads, which is not a reason to
 * reset a scope that may still be perfectly live.
 */
export function useRecordScope({
  books,
  searchParams,
  pathname,
  locale,
}: UseRecordScopeOptions): UseRecordScopeResult {
  const urlRecordScope = readRecordScopeSearchParams(searchParams);
  const recordScope = resolveLiveRecordScope(urlRecordScope, books);

  const onRecordScopeChange = useCallback(
    (scope: RecordScope) => {
      pushLedgerUrl(pathname, setRecordScopeSearchParams(searchParams, scope), locale, "filter");
    },
    [locale, pathname, searchParams]
  );

  useEffect(() => {
    if (urlRecordScope == null || recordScope !== null) return;
    replaceLedgerUrl(pathname, setRecordScopeSearchParams(searchParams, null), locale);
  }, [locale, pathname, recordScope, searchParams, urlRecordScope]);

  return { recordScope, onRecordScopeChange };
}
