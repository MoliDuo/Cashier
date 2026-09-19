import { describe, expect, it } from "vitest";
import { resolveLiveRecordScope } from "@/modules/workspace/record-scope";
import type { BookDto } from "@/modules/ledger/contracts";

const books: BookDto[] = [
  {
    id: "book-1",
    ledgerId: "ledger-1",
    name: "共同支出",
    timeZone: null,
    sortOrder: 1,
    archivedAt: null,
  },
];

describe("resolveLiveRecordScope", () => {
  it("keeps 总账 as 总账", () => {
    expect(resolveLiveRecordScope(null, books)).toBeNull();
  });

  it("keeps a scope that is still a live book", () => {
    expect(resolveLiveRecordScope("book-1", books)).toBe("book-1");
  });

  it("falls back to 总账 once the selected book is archived or deleted", () => {
    expect(resolveLiveRecordScope("book-2", books)).toBeNull();
    expect(resolveLiveRecordScope("book-2", [])).toBeNull();
  });

  it("does not reset while the books are still loading", () => {
    // undefined is "not answered yet", not "no books": a reset here would throw
    // away a perfectly live scope on every first paint.
    expect(resolveLiveRecordScope("book-2", undefined)).toBe("book-2");
  });
});
