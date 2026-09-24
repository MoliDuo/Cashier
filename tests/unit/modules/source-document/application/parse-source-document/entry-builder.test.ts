import { beforeEach, describe, expect, it, vi } from "vitest";

const { convertAmountMock, formatDateTimeForApiMock } = vi.hoisted(() => ({
  convertAmountMock: vi.fn(),
  formatDateTimeForApiMock: vi.fn(),
}));

vi.mock("@/lib/date-utils", () => ({
  formatDateTimeForApi: formatDateTimeForApiMock,
}));

import {
  buildEntriesForInsert,
  getEntryFallbackDate,
  validateEntries,
} from "@/modules/source-document/application/parse-source-document/entry-builder";

describe("entry-builder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    formatDateTimeForApiMock.mockReturnValue("2026-03-23");
  });

  it("fails the write when a required accounting conversion fails", async () => {
    convertAmountMock.mockRejectedValueOnce(new Error("rate unavailable"));

    await expect(
      buildEntriesForInsert({
        validEntries: [
          {
            amount: "10",
            currency: "USD",
            categoryIndex: 1,
            entryDate: null,
            itemName: "",
            notes: null,
          },
        ],
        categories: [{ id: "cat-1", name: "Food", description: null }],
        sourceDocumentId: "doc-1",
        ledgerId: "ledger-1",
        mainCurrency: "CNY",
        fallbackDate: "2026-03-20",
        convertAmount: convertAmountMock,
      })
    ).rejects.toThrow("rate unavailable");
  });

  it("category_index 0 means no category — categoryId is null", async () => {
    convertAmountMock.mockResolvedValueOnce({
      convertedAmount: "10.00",
      exchangeRate: "10.00",
    });

    const result = await buildEntriesForInsert({
      validEntries: [
        {
          amount: "10",
          currency: "CNY",
          categoryIndex: 0,
          entryDate: null,
          itemName: "Unknown item",
          notes: null,
        },
      ],
      categories: [
        { id: "cat-0", name: "Food", description: null },
        { id: "cat-1", name: "Transport", description: null },
      ],
      sourceDocumentId: "doc-1",
      ledgerId: "ledger-1",
      mainCurrency: "CNY",
      fallbackDate: "2026-03-20",
      convertAmount: convertAmountMock,
    });

    const firstEntry = result[0];
    expect(firstEntry).toBeDefined();
    if (firstEntry == null) {
      throw new Error("Expected first built entry");
    }

    expect(firstEntry.categoryId).toBeNull();
  });

  it("category_index 1 maps to first category, category_index 2 maps to second (1-based)", async () => {
    convertAmountMock
      .mockResolvedValueOnce({ convertedAmount: "10.00", exchangeRate: "1" })
      .mockResolvedValueOnce({ convertedAmount: "20.00", exchangeRate: "1" });

    const result = await buildEntriesForInsert({
      validEntries: [
        {
          amount: "10",
          currency: "CNY",
          categoryIndex: 1,
          entryDate: null,
          itemName: "Groceries",
          notes: null,
        },
        {
          amount: "20",
          currency: "CNY",
          categoryIndex: 2,
          entryDate: null,
          itemName: "Bus ticket",
          notes: null,
        },
      ],
      categories: [
        { id: "cat-0", name: "Food", description: null },
        { id: "cat-1", name: "Transport", description: null },
      ],
      sourceDocumentId: "doc-1",
      ledgerId: "ledger-1",
      mainCurrency: "CNY",
      fallbackDate: "2026-03-20",
      convertAmount: convertAmountMock,
    });

    const firstEntry = result[0];
    const secondEntry = result[1];
    expect(firstEntry).toBeDefined();
    expect(secondEntry).toBeDefined();
    if (firstEntry == null || secondEntry == null) {
      throw new Error("Expected two built entries");
    }

    expect(firstEntry.categoryId).toBe("cat-0");
    expect(secondEntry.categoryId).toBe("cat-1");
  });

  it("allows negative adjustment rows through validation", () => {
    expect(
      validateEntries([
        {
          amount: "-2",
          currency: "USD",
          categoryIndex: 0,
          entryDate: null,
          itemName: "Discount",
          notes: null,
          isAdjustment: true,
        },
      ])
    ).toEqual({ isValid: true });
  });

  it("rejects entries with no positive amounts or unknown currencies", () => {
    expect(
      validateEntries([
        {
          amount: "0",
          currency: "CNY",
          categoryIndex: 0,
          entryDate: null,
          itemName: "Ignored",
          notes: null,
        },
      ])
    ).toEqual({ isValid: false, reason: "Invalid expense amount" });

    expect(
      validateEntries([
        {
          amount: "12",
          currency: "unknown",
          categoryIndex: 0,
          entryDate: null,
          itemName: "Bad currency",
          notes: null,
        },
      ])
    ).toEqual({ isValid: false, reason: "Unable to recognize currency type" });
  });

  it("uses the document entry date when present and today otherwise", () => {
    expect(getEntryFallbackDate("2026-03-20")).toEqual({
      todayDate: "2026-03-23",
      fallbackDate: "2026-03-20",
    });

    expect(getEntryFallbackDate(null)).toEqual({
      todayDate: "2026-03-23",
      fallbackDate: "2026-03-23",
    });
  });
});
