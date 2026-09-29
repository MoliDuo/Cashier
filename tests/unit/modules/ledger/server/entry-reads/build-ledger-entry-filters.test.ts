import { describe, expect, it } from "vitest";
import {
  buildLedgerEntryCursorCondition,
  encodeLedgerEntryCursor,
} from "@/modules/ledger/server/entry-reads/build-ledger-entry-filters";

describe("buildLedgerEntryCursorCondition", () => {
  it("rejects malformed cursors", () => {
    expect(() => buildLedgerEntryCursorCondition("not-a-date|entry-1", {})).toThrow(
      "Invalid ledger entry cursor"
    );
  });

  it("binds valid cursors to the query", () => {
    const cursor = encodeLedgerEntryCursor(
      {
        documentDate: "2026-03-01",
        documentCreatedAt: "2026-03-01T08:00:00.000Z",
        documentId: "22222222-2222-4222-8222-222222222222",
        position: 0,
        entryId: "33333333-3333-4333-8333-333333333333",
      },
      { currency: "USD" }
    );

    expect(buildLedgerEntryCursorCondition(cursor, { currency: "USD" })).not.toBeNull();
    expect(() => buildLedgerEntryCursorCondition(cursor, { currency: "EUR" })).toThrow(
      "does not match"
    );
  });

  it("rejects oversized cursors", () => {
    expect(() => buildLedgerEntryCursorCondition("a".repeat(1025), {})).toThrow(
      "Invalid ledger entry cursor"
    );
  });
});
