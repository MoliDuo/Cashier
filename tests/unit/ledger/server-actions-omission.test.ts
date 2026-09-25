import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createLedgerEntryWithConversionMock,
  batchUpdateLedgerEntriesMock,
  calculateLedgerEntryStatsMock,
} = vi.hoisted(() => ({
  createLedgerEntryWithConversionMock: vi.fn(),
  batchUpdateLedgerEntriesMock: vi.fn(),
  calculateLedgerEntryStatsMock: vi.fn(),
}));

vi.mock("@/lib/auth-actions", () => ({
  withAuth:
    <TArgs extends unknown[], TResult>(handler: (userId: string, ...args: TArgs) => TResult) =>
    (...args: TArgs) =>
      handler("user-1", ...args),
}));

vi.mock("next-intl/server", () => ({ getLocale: vi.fn().mockResolvedValue("zh") }));

vi.mock("@/modules/ledger/access", () => ({
  withLedgerAccess:
    <TArgs extends unknown[], TResult>(handler: (ledgerId: string, ...args: TArgs) => TResult) =>
    (...args: TArgs) =>
      handler("ledger-1", ...args),
}));

vi.mock("@/modules/source-document/server/entry-commands", () => ({
  addLedgerEntry: createLedgerEntryWithConversionMock,
  deleteLedgerEntry: vi.fn(),
  batchUpdateLedgerEntries: batchUpdateLedgerEntriesMock,
  batchDeleteLedgerEntries: vi.fn(),
}));
vi.mock("@/modules/source-document/server/updates", () => ({
  updateLedgerEntryDates: vi.fn(),
}));
vi.mock("@/modules/ledger/server/entry-reads/calculate-ledger-entry-stats", () => ({
  calculateLedgerEntryStats: calculateLedgerEntryStatsMock,
}));

import {
  batchUpdateLedgerEntriesAction,
  createLedgerEntryAction,
} from "@/modules/ledger/server-actions/entries";
import { calculateLedgerStats as calculateLedgerStatsQuery } from "@/modules/ledger/server/stats";

const calculateLedgerStats = (ledgerId: string) => calculateLedgerStatsQuery(ledgerId, {});

describe("ledger server action omission semantics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createLedgerEntryWithConversionMock.mockResolvedValue({ id: "entry-1" });
    batchUpdateLedgerEntriesMock.mockResolvedValue(1);
    calculateLedgerEntryStatsMock.mockResolvedValue({
      convertedTotal: { total: 0, currency: "CNY" },
      totals: [],
      trend: [],
      byCategory: [],
    });
  });

  it("omits absent optional create-entry fields", async () => {
    await createLedgerEntryAction({
      amount: "12.5",
      itemName: "Lunch",
      sourceDocumentId: "123e4567-e89b-42d3-a456-426614174000",
    });

    const payload = createLedgerEntryWithConversionMock.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;

    expect(payload.ledgerId).toBe("ledger-1");
    expect(payload.sourceDocumentId).toBe("123e4567-e89b-42d3-a456-426614174000");
    expect(payload.amount).toBe("12.5");
    expect(payload.itemName).toBe("Lunch");
    expect(Object.prototype.hasOwnProperty.call(payload, "currency")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(payload, "categoryId")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(payload, "description")).toBe(false);
  });

  it("omits absent optional batch-update fields", async () => {
    await batchUpdateLedgerEntriesAction(
      ["123e4567-e89b-42d3-a456-426614174000"],
      ["123e4567-e89b-42d3-a456-426614174002"],
      { amount: "9.99" }
    );

    const payload = batchUpdateLedgerEntriesMock.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(payload.ledgerId).toBe("ledger-1");
    expect(payload.sourceDocumentIds).toEqual(["123e4567-e89b-42d3-a456-426614174000"]);
    expect(payload.ledgerEntryIds).toEqual(["123e4567-e89b-42d3-a456-426614174002"]);
    expect(payload.amount).toBe("9.99");
    expect(Object.prototype.hasOwnProperty.call(payload, "categoryId")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(payload, "currency")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(payload, "description")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(payload, "itemName")).toBe(false);
  });

  it("omits absent stats filters", async () => {
    await calculateLedgerStats("ledger-1");

    const payload = calculateLedgerEntryStatsMock.mock.calls[0]?.[0] as Record<string, unknown>;
    const filters = payload.filters as Record<string, unknown>;

    expect(payload.ledgerId).toBe("ledger-1");
    expect(Object.prototype.hasOwnProperty.call(payload, "mainCurrency")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(filters, "startDate")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(filters, "endDate")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(filters, "categoryId")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(filters, "currency")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(filters, "minAmount")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(filters, "maxAmount")).toBe(false);
  });
});
