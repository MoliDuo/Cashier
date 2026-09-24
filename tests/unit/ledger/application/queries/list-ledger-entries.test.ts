import { beforeEach, describe, expect, it, vi } from "vitest";

const { listEntries, calculateStats } = vi.hoisted(() => ({
  listEntries: vi.fn(),
  calculateStats: vi.fn(),
}));

vi.mock("@/modules/ledger/access", () => ({ withLedgerAccess: vi.fn() }));
vi.mock("@/modules/ledger/server/entry-reads/list-ledger-entry-page", () => ({
  listLedgerEntryPage: listEntries,
}));
vi.mock("@/modules/ledger/server/entry-reads/calculate-ledger-entry-stats", () => ({
  calculateLedgerEntryStats: calculateStats,
}));

import { listLedgerEntries } from "@/modules/ledger/server/list-entries";
import { calculateLedgerStats } from "@/modules/ledger/server/stats";

describe("listLedgerEntries", () => {
  beforeEach(() => {
    listEntries.mockReset();
  });

  it("validates params and builds filters", async () => {
    listEntries.mockResolvedValueOnce({
      items: [{ id: "entry-1" }],
      nextCursor: null,
    });

    const result = await listLedgerEntries("ledger-1", {
      limit: "20" as never,
      cursor: undefined,
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      categoryId: "11111111-1111-4111-8111-111111111111",
      currency: "USD",
      minAmount: "10" as never,
      maxAmount: "50" as never,
    });

    expect(listEntries).toHaveBeenCalledWith({
      ledgerId: "ledger-1",
      limit: 20,
      cursor: null,
      filters: {
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        categoryId: "11111111-1111-4111-8111-111111111111",
        currency: "USD",
        minAmount: "10",
        maxAmount: "50",
      },
    });
    expect(result).toEqual({
      items: [{ id: "entry-1" }],
      nextCursor: null,
    });
  });

  it("throws validation errors for invalid params", async () => {
    await expect(
      listLedgerEntries("ledger-1", {
        limit: 0,
      })
    ).rejects.toThrow("Validation failed");
  });

  it("maps the uncategorized sentinel to the null-category filter", async () => {
    listEntries.mockResolvedValueOnce({ items: [], nextCursor: null });

    await listLedgerEntries("ledger-1", {
      categoryId: "__uncategorized__",
      limit: 20,
    });

    expect(listEntries).toHaveBeenCalledWith({
      ledgerId: "ledger-1",
      limit: 20,
      cursor: null,
      filters: { uncategorizedOnly: true },
    });
  });

  it("asks for the same window the totals do", async () => {
    listEntries.mockResolvedValueOnce({ items: [], nextCursor: null });
    calculateStats.mockResolvedValueOnce({ total: "0" });
    const window = {
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      categoryId: "__uncategorized__",
      currency: "USD",
      minAmount: "10",
      maxAmount: "50",
      search: "  coffee  ",
    };

    await listLedgerEntries("ledger-1", { ...window, limit: 20 });
    await calculateLedgerStats("ledger-1", window);

    expect(listEntries.mock.calls[0]![0].filters).toEqual({
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      currency: "USD",
      minAmount: "10",
      maxAmount: "50",
      search: "coffee",
      uncategorizedOnly: true,
    });
    expect(calculateStats.mock.calls[0]![0].filters).toEqual(listEntries.mock.calls[0]![0].filters);
  });
});
