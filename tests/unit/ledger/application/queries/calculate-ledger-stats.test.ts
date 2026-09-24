import { beforeEach, describe, expect, it, vi } from "vitest";

const { calculateStats } = vi.hoisted(() => ({ calculateStats: vi.fn() }));

vi.mock("@/modules/ledger/access", () => ({ withLedgerAccess: vi.fn() }));
vi.mock("@/modules/ledger/server/entry-reads/calculate-ledger-entry-stats", () => ({
  calculateLedgerEntryStats: calculateStats,
}));

import { calculateLedgerStats as calculateLedgerStatsQuery } from "@/modules/ledger/server/stats";

const calculateLedgerStats = (ledgerId: string, query: unknown = {}) =>
  calculateLedgerStatsQuery(ledgerId, query);

describe("calculateLedgerStats", () => {
  beforeEach(() => {
    calculateStats.mockReset();
  });

  it("passes through only provided filters", async () => {
    calculateStats.mockResolvedValueOnce({ total: "ok" });

    const result = await calculateLedgerStats("ledger-1", {
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      categoryId: "11111111-1111-4111-8111-111111111111",
      currency: "CNY",
      minAmount: "10",
      maxAmount: "99",
    });

    expect(result).toEqual({ total: "ok" });
    expect(calculateStats).toHaveBeenCalledWith({
      ledgerId: "ledger-1",
      filters: {
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        categoryId: "11111111-1111-4111-8111-111111111111",
        currency: "CNY",
        minAmount: "10",
        maxAmount: "99",
      },
    });
  });

  it("normalizes the uncategorized sentinel to an uncategorized only filter", async () => {
    calculateStats.mockResolvedValueOnce({ total: "sentinel" });

    const result = await calculateLedgerStats("ledger-3", {
      categoryId: "__uncategorized__",
      currency: "USD",
    });

    expect(result).toEqual({ total: "sentinel" });
    expect(calculateStats).toHaveBeenCalledWith({
      ledgerId: "ledger-3",
      filters: { currency: "USD", uncategorizedOnly: true },
    });
  });

  it("keeps an empty filters object when no optional values are provided", async () => {
    calculateStats.mockResolvedValueOnce({ total: "base" });

    await calculateLedgerStats("ledger-2");

    expect(calculateStats).toHaveBeenCalledWith({ ledgerId: "ledger-2", filters: {} });
  });

  it("rejects a query it cannot read before the database is asked to count it", async () => {
    await expect(calculateLedgerStats("ledger-1", { minAmount: "abc" })).rejects.toThrow(
      "Validation failed"
    );
    await expect(calculateLedgerStats("ledger-1", { uncategorizedOnly: true })).rejects.toThrow(
      "Validation failed"
    );

    expect(calculateStats).not.toHaveBeenCalled();
  });

  it("normalizes the search term the same way listing does", async () => {
    calculateStats.mockResolvedValueOnce({ total: "searched" });

    await calculateLedgerStats("ledger-1", { search: "  coffee  " });

    expect(calculateStats).toHaveBeenCalledWith({
      ledgerId: "ledger-1",
      filters: { search: "coffee" },
    });
  });
});
