import { describe, expect, it } from "vitest";
import { buildLedgerEntryFilters } from "@/modules/workspace/ledger-filter-state";

describe("ledger-filter-state", () => {
  it("carries the advanced filters into the dialog's filters", () => {
    const filters = buildLedgerEntryFilters({
      categoryId: "cat-1",
      minAmount: "20",
      maxAmount: "100",
    });

    expect(filters).toEqual({ categoryId: "cat-1", minAmount: "20", maxAmount: "100" });
  });

  it("includes statuses only when the URL names some", () => {
    expect(buildLedgerEntryFilters({ statuses: ["failed"] }).statuses).toEqual(["failed"]);
    expect(buildLedgerEntryFilters({ categoryId: "cat-1" }).statuses).toBeUndefined();
  });

  it("has no days of its own: the period carries them", () => {
    expect(buildLedgerEntryFilters({})).toEqual({});
  });
});
