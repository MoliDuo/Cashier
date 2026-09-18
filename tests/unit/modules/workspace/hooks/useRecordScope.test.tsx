import { describe, expect, it, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRecordScope } from "@/modules/workspace/hooks/useRecordScope";
import type { BookDto } from "@/modules/ledger/contracts";

const BOOK_LIVE = "10000000-0000-4000-8000-000000000001";
const BOOK_GONE = "10000000-0000-4000-8000-000000000002";

const liveBook: BookDto = {
  id: BOOK_LIVE,
  ledgerId: "ledger-1",
  name: "共同支出",
  timeZone: null,
  sortOrder: 1,
  isDefault: true,
  archivedAt: null,
};

function renderScope(init: string, books: readonly BookDto[] | undefined) {
  window.history.replaceState({}, "", `/ledgers/ledger-1${init}`);
  const searchParams = new URLSearchParams(window.location.search);
  const view = renderHook(() =>
    useRecordScope({
      books,
      searchParams,
      pathname: "/ledgers/ledger-1",
      locale: "en",
    })
  );
  return { ...view, searchParams };
}

describe("useRecordScope", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("reads the selected book out of the URL", () => {
    const { result } = renderScope(`?bookId=${BOOK_LIVE}`, [liveBook]);
    expect(result.current.recordScope).toBe(BOOK_LIVE);
  });

  it("treats a malformed book id as 总账 instead of forwarding it", () => {
    const { result } = renderScope("?bookId=not-a-book", [liveBook]);
    expect(result.current.recordScope).toBeNull();
  });

  it("resets an archived or deleted book to 总账 and takes it out of the URL", async () => {
    const replace = vi.spyOn(window.history, "replaceState");
    const { result } = renderScope(`?bookId=${BOOK_GONE}`, [liveBook]);

    expect(result.current.recordScope).toBeNull();
    await vi.waitFor(() => {
      expect(window.location.search).toBe("");
    });
    expect(replace).toHaveBeenCalled();
    expect(window.location.search).not.toContain(BOOK_GONE);
  });

  it("does not reset while the books list is still loading", () => {
    window.history.replaceState({}, "", `/ledgers/ledger-1?bookId=${BOOK_GONE}`);
    const searchParams = new URLSearchParams(window.location.search);
    const replace = vi.spyOn(window.history, "replaceState");
    const { result } = renderHook(() =>
      useRecordScope({
        books: undefined,
        searchParams,
        pathname: "/ledgers/ledger-1",
        locale: "en",
      })
    );

    expect(result.current.recordScope).toBe(BOOK_GONE);
    expect(window.location.search).toBe(`?bookId=${BOOK_GONE}`);
    expect(replace).not.toHaveBeenCalled();
  });

  it("pushes the picked book into the URL as its own history entry", () => {
    const push = vi.spyOn(window.history, "pushState");
    const { result } = renderScope("", [liveBook]);

    result.current.onRecordScopeChange(BOOK_LIVE);

    expect(push).toHaveBeenCalled();
    expect(window.location.search).toBe(`?bookId=${BOOK_LIVE}`);
  });
});
