import { describe, expect, it } from "vitest";
import {
  buildLedgerEntryFilters,
  buildLedgerFilterKey,
  splitLedgerFilterChange,
} from "@/modules/workspace/ledger-filter-state";

describe("ledger-filter-state", () => {
  it("derives entry filters and filterKey from period + advanced filters", () => {
    const filters = buildLedgerEntryFilters(
      { period: "custom", startDate: "2026-03-01", endDate: "2026-03-31" },
      { categoryId: "cat-1", minAmount: "20", maxAmount: "100" }
    );

    expect(filters.categoryId).toBe("cat-1");
    expect(buildLedgerFilterKey(filters)).toBe("cat:cat-1|min:20|max:100");
  });

  it("includes statuses from advanced filters in entry filters", () => {
    const filters = buildLedgerEntryFilters(
      { period: "thisMonth" },
      { statuses: ["failed", "failed"] }
    );

    expect(filters.statuses).toEqual(["failed", "failed"]);
  });

  it("omits statuses from entry filters when advanced filters has no statuses", () => {
    const filters = buildLedgerEntryFilters({ period: "thisMonth" }, { categoryId: "cat-1" });

    expect(filters.statuses).toBeUndefined();
  });

  it("splits a filter edit into period and advanced updates", () => {
    const result = splitLedgerFilterChange({
      currentPeriod: { period: "thisMonth" },
      currentFilters: {},
      nextFilters: {
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        currency: "USD",
      },
    });

    expect(result.periodUpdate).toEqual({
      period: "custom",
      startDate: "2026-03-01",
      endDate: "2026-03-31",
    });
    expect(result.advancedFilterUpdate).toEqual({
      currency: "USD",
    });
  });

  it("splits statuses change into advanced filter update without period change", () => {
    const result = splitLedgerFilterChange({
      currentPeriod: { period: "thisMonth" },
      currentFilters: {},
      nextFilters: {
        statuses: ["processing", "failed"],
      },
    });

    expect(result.periodUpdate).toBeUndefined();
    expect(result.advancedFilterUpdate).toEqual({
      statuses: ["processing", "failed"],
    });
  });

  it("clears statuses through advanced filter update", () => {
    const result = splitLedgerFilterChange({
      currentPeriod: { period: "thisMonth" },
      currentFilters: { statuses: ["failed"] },
      nextFilters: {
        statuses: [],
      },
    });

    expect(result.periodUpdate).toBeUndefined();
    expect(result.advancedFilterUpdate).toEqual({
      statuses: [],
    });
  });

  it("preserves the all-time period when date fields are cleared", () => {
    const result = splitLedgerFilterChange({
      currentPeriod: { period: "custom", startDate: "2026-01-01", endDate: "2026-01-31" },
      currentFilters: { startDate: "2026-01-01", endDate: "2026-01-31" },
      nextFilters: {},
      requestedPeriod: "all",
    });

    expect(result.periodUpdate).toEqual({ period: "all" });
  });

  it("round-trips a named preset by name instead of reconstructing it as custom", () => {
    // Regression: previously only "all" round-tripped by name — every other
    // preset (including lastMonth) was written back as period=custom with
    // explicit dates, forcing EntryFilterPanel to fuzzy-match dates back to
    // a preset name on the next read.
    const result = splitLedgerFilterChange({
      currentPeriod: { period: "thisMonth" },
      currentFilters: { startDate: "2026-03-01", endDate: "2026-03-31" },
      nextFilters: { startDate: "2026-02-01", endDate: "2026-02-28" },
      requestedPeriod: "lastMonth",
    });

    expect(result.periodUpdate).toEqual({ period: "lastMonth" });
  });

  it("still reconstructs custom with explicit dates when requestedPeriod is custom", () => {
    const result = splitLedgerFilterChange({
      currentPeriod: { period: "thisMonth" },
      currentFilters: {},
      nextFilters: { startDate: "2026-03-01", endDate: "2026-03-31" },
      requestedPeriod: "custom",
    });

    expect(result.periodUpdate).toEqual({
      period: "custom",
      startDate: "2026-03-01",
      endDate: "2026-03-31",
    });
  });
});
