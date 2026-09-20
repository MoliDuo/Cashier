import { beforeEach, describe, expect, it, vi } from "vitest";

import { listLedgerEntries as listLedgerEntriesUseCase } from "@/modules/ledger/application/queries/list-ledger-entries";
import { calculateLedgerStats as calculateLedgerStatsUseCase } from "@/modules/ledger/application/queries/calculate-ledger-stats";
import type { LedgerReadPort } from "@/modules/ledger/application/ports";

const listEntries = vi.fn();
const calculateStats = vi.fn();
const reads = { listEntries } as unknown as LedgerReadPort;
const listLedgerEntries = (
  ledgerId: string,
  input: Parameters<typeof listLedgerEntriesUseCase>[1]
) => listLedgerEntriesUseCase(ledgerId, input, reads);

describe("listLedgerEntries", () => {
  beforeEach(() => {
    listEntries.mockReset();
  });

  it("validates params, builds filters, and normalizes nextCursor to null", async () => {
    listEntries.mockResolvedValueOnce({
      items: [{ id: "entry-1" }],
      nextCursor: undefined,
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
    await calculateLedgerStatsUseCase("ledger-1", window, {
      calculateStats,
    } as unknown as LedgerReadPort);

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
