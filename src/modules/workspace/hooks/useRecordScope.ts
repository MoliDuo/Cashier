"use client";

import { useCallback, useEffect, useState } from "react";
import type { BookDto } from "@/modules/ledger/contracts";
import type { RecordScope } from "@/modules/ledger/filters";
import { resolveLiveRecordScope } from "../record-scope";
import { writeBookScopeCookie } from "@/lib/book-scope-cookie";
import { useBookScopeStore } from "@/lib/store/book-scope";

interface UseRecordScopeOptions {
  /** The live books the scope is validated against; undefined while loading. */
  books: readonly BookDto[] | undefined;
  /**
   * The scope the server resolved from this device's remembered choice, null
   * for 总账. Seeding from it — rather than from the store — is what keeps the
   * hydration render identical to the server's.
   */
  initialScope: string | null;
}

interface UseRecordScopeResult {
  /** The book the page is showing, or null for 总账. */
  recordScope: RecordScope;
  onRecordScopeChange: (scope: RecordScope) => void;
}

/**
 * The page's book scope: this device's last choice, remembered by a cookie the
 * server reads before the first request renders. Picking a book is therefore
 * not a history entry either — Back belongs to navigation, not to a preference.
 */
export function useRecordScope({
  books,
  initialScope,
}: UseRecordScopeOptions): UseRecordScopeResult {
  const [scope, setScope] = useState<RecordScope>(initialScope);
  const setSharedScope = useBookScopeStore((state) => state.setBookId);

  const recordScope = resolveLiveRecordScope(scope, books);

  // A selected book can be archived or deleted while it is the scope — 设置 is
  // one tab away. Once the live list says it is gone, the scope falls back to
  // 总账 here, during render, so no committed frame ever shows a dead book and
  // a later restore cannot resurrect it. The list is undefined while it loads,
  // which is not a reason to reset a scope that may still be perfectly live.
  if (scope != null && books !== undefined && recordScope == null) {
    setScope(null);
  }

  // The shell's hover prefetch reads the shared store, and the cookie is what
  // the next page load and a new tab are remembered by; both follow the view.
  useEffect(() => {
    setSharedScope(scope);
    writeBookScopeCookie(scope);
  }, [scope, setSharedScope]);

  const onRecordScopeChange = useCallback(
    (next: RecordScope) => {
      setScope(next);
    },
    [setScope]
  );

  return { recordScope, onRecordScopeChange };
}
