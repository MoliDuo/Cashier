import { describe, expect, it } from "vitest";
import {
  buildLedgerEntryCursorCondition,
  buildLedgerEntryFilterConditions,
  encodeLedgerEntryCursor,
} from "@/modules/ledger/server/entry-reads/build-ledger-entry-filters";
import type { LedgerEntryFilterParams } from "@/modules/ledger/server/entry-reads/build-ledger-entry-filters";

describe("buildLedgerEntryCursorCondition", () => {
  it("rejects malformed cursors", () => {
    expect(() => buildLedgerEntryCursorCondition("not-a-date|entry-1", "ledger-1", {})).toThrow(
      "Invalid ledger entry cursor"
    );
  });

  it("binds valid cursors to the ledger and query", () => {
    const ledgerId = "11111111-1111-4111-8111-111111111111";
    const cursor = encodeLedgerEntryCursor(
      {
        effectiveDate: "2026-03-01",
        documentCreatedAt: "2026-03-01T08:00:00.000Z",
        documentId: "22222222-2222-4222-8222-222222222222",
        position: 0,
        entryId: "33333333-3333-4333-8333-333333333333",
      },
      ledgerId,
      { currency: "USD" }
    );

    expect(buildLedgerEntryCursorCondition(cursor, ledgerId, { currency: "USD" })).not.toBeNull();
    expect(() =>
      buildLedgerEntryCursorCondition(cursor, "44444444-4444-4444-8444-444444444444", {
        currency: "USD",
      })
    ).toThrow("does not match");
    expect(() => buildLedgerEntryCursorCondition(cursor, ledgerId, { currency: "EUR" })).toThrow(
      "does not match"
    );
  });

  it("rejects oversized cursors", () => {
    expect(() => buildLedgerEntryCursorCondition("a".repeat(1025), "ledger-1", {})).toThrow(
      "Invalid ledger entry cursor"
    );
  });
});

describe("buildLedgerEntryFilterConditions", () => {
  it("treats undefined date filters the same as omitted date filters", () => {
    const omitted = buildLedgerEntryFilterConditions("ledger-1", {});
    const explicitUndefinedFilters = {
      startDate: undefined,
      endDate: undefined,
    } as unknown as LedgerEntryFilterParams;
    const explicitUndefined = buildLedgerEntryFilterConditions(
      "ledger-1",
      explicitUndefinedFilters
    );

    expect(explicitUndefined).toHaveLength(omitted.length);
  });

  it("adds supported category, currency, and amount filters without search", () => {
    const base = buildLedgerEntryFilterConditions("ledger-1", {});
    const filtered = buildLedgerEntryFilterConditions("ledger-1", {
      categoryId: "11111111-1111-4111-8111-111111111111",
      currency: "USD",
      minAmount: "10",
      maxAmount: "50",
    });

    expect(filtered.length).toBe(base.length + 4);
  });
});
