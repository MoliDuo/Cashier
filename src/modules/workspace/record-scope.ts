import type { BookDto } from "@/modules/ledger/contracts";
import type { RecordScope } from "@/modules/ledger/filters";

/**
 * The book scope a page can still show. A selected book that is no longer live
 * — archived or deleted while it was selected — falls back to 总账, and the
 * caller writes that back to the URL so a reload or a share does not restore
 * the dead id.
 *
 * An undefined list means the books are still loading, not that there are none,
 * so an unknown scope has to wait rather than reset.
 */
export function resolveLiveRecordScope(
  scope: RecordScope,
  books: readonly BookDto[] | undefined
): RecordScope {
  if (scope == null) return null;
  if (books === undefined) return scope;
  return books.some((book) => book.id === scope) ? scope : null;
}
