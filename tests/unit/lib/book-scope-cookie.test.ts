import { describe, expect, it } from "vitest";
import {
  BOOK_SCOPE_COOKIE,
  buildBookScopeCookie,
  parseBookScopeCookie,
} from "@/lib/book-scope-cookie";

const BOOK_ID = "10000000-0000-4000-8000-000000000001";

describe("book scope cookie", () => {
  it("serializes 总账 as `all` and a book as its id", () => {
    expect(buildBookScopeCookie(null)).toBe(
      `${BOOK_SCOPE_COOKIE}=all; path=/; max-age=31536000; samesite=lax`
    );
    expect(buildBookScopeCookie(BOOK_ID)).toBe(
      `${BOOK_SCOPE_COOKIE}=${BOOK_ID}; path=/; max-age=31536000; samesite=lax`
    );
  });

  it("reads a book id back", () => {
    expect(parseBookScopeCookie(BOOK_ID)).toBe(BOOK_ID);
  });

  it("reads `all`, absent, and malformed values as 总账", () => {
    expect(parseBookScopeCookie("all")).toBeNull();
    expect(parseBookScopeCookie("")).toBeNull();
    expect(parseBookScopeCookie(null)).toBeNull();
    expect(parseBookScopeCookie(undefined)).toBeNull();
    // A forged value must not travel into a query.
    expect(parseBookScopeCookie("not-a-book")).toBeNull();
    expect(parseBookScopeCookie("'; DROP TABLE books; --")).toBeNull();
  });
});
