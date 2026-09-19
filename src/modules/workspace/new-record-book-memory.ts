import { isValidUuid } from "@/lib/validation";

const LAST_NEW_RECORD_BOOK_KEY = "cashier:new-record-book";

/**
 * The book the reader last picked in the 记一笔 picker, on this device and this
 * browser only — a picker default, not a preference the server needs, so
 * localStorage rather than a cookie. Storage can be unavailable (private mode,
 * disabled, quota); every failure reads as "no memory", and the picker falls
 * back to its first book.
 */
export function readLastNewRecordBookId(): string | null {
  try {
    const stored = window.localStorage.getItem(LAST_NEW_RECORD_BOOK_KEY);
    return stored != null && isValidUuid(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Remembers the book a record was just saved into. Only successes write —
 * picking a book and then cancelling is not "the last choice".
 */
export function writeLastNewRecordBookId(bookId: string): void {
  try {
    window.localStorage.setItem(LAST_NEW_RECORD_BOOK_KEY, bookId);
  } catch {
    // No memory is a working default; nothing to report.
  }
}
