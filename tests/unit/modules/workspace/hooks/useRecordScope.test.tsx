import { describe, expect, it, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useRecordScope } from "@/modules/workspace/hooks/useRecordScope";
import { useBookScopeStore } from "@/lib/store/book-scope";
import type { BookDto } from "@/modules/ledger/contracts";

const BOOK_LIVE = "10000000-0000-4000-8000-000000000001";
const BOOK_GONE = "10000000-0000-4000-8000-000000000002";

const liveBook: BookDto = {
  id: BOOK_LIVE,
  ledgerId: "ledger-1",
  name: "共同支出",
  timeZone: null,
  sortOrder: 1,
  archivedAt: null,
};

function renderScope(initialScope: string | null, books: readonly BookDto[] | undefined) {
  return renderHook(() => useRecordScope({ books, initialScope }));
}

describe("useRecordScope", () => {
  beforeEach(() => {
    document.cookie = "CASHIER_BOOK_SCOPE=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    act(() => useBookScopeStore.getState().setBookId(null));
  });

  it("starts on the scope the server resolved", () => {
    const { result } = renderScope(BOOK_LIVE, [liveBook]);
    expect(result.current.recordScope).toBe(BOOK_LIVE);
  });

  it("starts on 总账 for a first visit", () => {
    const { result } = renderScope(null, [liveBook]);
    expect(result.current.recordScope).toBeNull();
  });

  it("publishes the scope to the shared store and writes the cookie on a pick", () => {
    const { result } = renderScope(null, [liveBook]);

    act(() => result.current.onRecordScopeChange(BOOK_LIVE));

    expect(result.current.recordScope).toBe(BOOK_LIVE);
    expect(useBookScopeStore.getState().bookId).toBe(BOOK_LIVE);
    expect(document.cookie).toContain(`CASHIER_BOOK_SCOPE=${BOOK_LIVE}`);
  });

  it("writes `all` to the cookie when the reader returns to 总账", () => {
    document.cookie = `CASHIER_BOOK_SCOPE=${BOOK_LIVE}; path=/`;
    const { result } = renderScope(BOOK_LIVE, [liveBook]);

    act(() => result.current.onRecordScopeChange(null));

    expect(result.current.recordScope).toBeNull();
    expect(useBookScopeStore.getState().bookId).toBeNull();
    expect(document.cookie).toContain("CASHIER_BOOK_SCOPE=all");
  });

  it("resets an archived or deleted book to 总账 and forgets it in the cookie", () => {
    document.cookie = `CASHIER_BOOK_SCOPE=${BOOK_GONE}; path=/`;
    const { result } = renderScope(BOOK_GONE, [liveBook]);

    expect(result.current.recordScope).toBeNull();
    expect(document.cookie).toContain("CASHIER_BOOK_SCOPE=all");
  });

  it("does not reset while the books list is still loading", () => {
    const { result } = renderScope(BOOK_GONE, undefined);

    expect(result.current.recordScope).toBe(BOOK_GONE);
  });

  it("keeps the remembered book in the cookie while the list is unresolved", () => {
    document.cookie = `CASHIER_BOOK_SCOPE=${BOOK_GONE}; path=/`;
    const { result } = renderScope(BOOK_GONE, undefined);

    // A list that has not answered is not evidence that the book is gone, so
    // neither the scope nor the memory of it may fall back to 总账 yet.
    expect(result.current.recordScope).toBe(BOOK_GONE);
    expect(document.cookie).toContain(`CASHIER_BOOK_SCOPE=${BOOK_GONE}`);
    expect(document.cookie).not.toContain("CASHIER_BOOK_SCOPE=all");
  });

  it("does not fall back for a live scope once the books arrive", () => {
    const { result, rerender } = renderScope(BOOK_LIVE, undefined);

    rerender({ books: [liveBook], initialScope: BOOK_LIVE });

    expect(result.current.recordScope).toBe(BOOK_LIVE);
  });
});
