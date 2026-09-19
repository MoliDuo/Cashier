import { isValidUuid } from "./validation";

/**
 * The book this device last looked at, carried to the server so the first
 * request already prefetches the right scope — no flash of 总账 before a
 * remembered book settles. The value is `all` for 总账 or a book id; a year is
 * the usual "remember a choice" horizon, and an absent or malformed cookie
 * reads as 总账, which is what a first visit shows.
 */
export const BOOK_SCOPE_COOKIE = "CASHIER_BOOK_SCOPE";

const BOOK_SCOPE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Serializes the scope into the Set-Cookie value `document.cookie` takes. */
export function buildBookScopeCookie(bookId: string | null): string {
  return `${BOOK_SCOPE_COOKIE}=${bookId ?? "all"}; path=/; max-age=${BOOK_SCOPE_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

/**
 * The scope a cookie value holds: `null` for 总账 (the absent, `all`, or
 * malformed case) or the book id it names. The cookie is external input
 * wherever it is read, so a forged value must not travel into a query.
 */
export function parseBookScopeCookie(value: string | null | undefined): string | null {
  if (value == null || value === "" || value === "all" || !isValidUuid(value)) return null;
  return value;
}

/**
 * Writes the remembered scope where the server can read it. Client only; the
 * cookie is what keeps the next page load and a new tab on this device's view.
 */
export function writeBookScopeCookie(bookId: string | null): void {
  document.cookie = buildBookScopeCookie(bookId);
}
