"use client";

import { useEffect } from "react";
import type { BookDto } from "@/modules/ledger/contracts";
import type { RecordScope } from "@/modules/ledger/filters";
import { resolveLiveRecordScope } from "../record-scope";
import { writeBookScopeCookie } from "@/lib/book-scope-cookie";
import { useWorkspaceStore } from "../store";

interface UseRecordScopeResult {
  /** The book the page is showing, or null for 总账. */
  recordScope: RecordScope;
  onRecordScopeChange: (scope: RecordScope) => void;
}

/**
 * The page's book scope: this device's last choice, remembered by a cookie the
 * server reads before the first request renders. Picking a book is therefore
 * not a history entry either — Back belongs to navigation, not to a preference.
 *
 * @param books The live books the scope is validated against; undefined while loading.
 */
export function useRecordScope(books: readonly BookDto[] | undefined): UseRecordScopeResult {
  const scope = useWorkspaceStore((state) => state.bookId);
  const setScope = useWorkspaceStore((state) => state.setBookId);

  // A selected book can be archived or deleted while it is the scope — 设置 is
  // one tab away. The rendered scope falls back to 总账 as soon as the live list
  // says it is gone, so no frame shows a dead book, and the effect below then
  // forgets it. The list is undefined while it loads, which is not a reason to
  // reset a scope that may still be perfectly live.
  const recordScope = resolveLiveRecordScope(scope, books);
  const dead = scope != null && recordScope == null;

  useEffect(() => {
    if (dead) setScope(null);
  }, [dead, setScope]);

  // The cookie is what the next page load and a new tab are remembered by.
  useEffect(() => {
    if (!dead) writeBookScopeCookie(scope);
  }, [dead, scope]);

  return { recordScope, onRecordScopeChange: setScope };
}
