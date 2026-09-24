import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  formatDateTimeForApiMock,
  getDateInTimezoneMock,
  getEntryCategoryNameMock,
  createManualMock,
  convertAmountMock,
} = vi.hoisted(() => ({
  formatDateTimeForApiMock: vi.fn(),
  getDateInTimezoneMock: vi.fn<() => string | undefined>(() => undefined),
  getEntryCategoryNameMock: vi.fn(),
  createManualMock: vi.fn(),
  convertAmountMock: vi.fn(),
}));

vi.mock("@/lib/date-utils", () => ({
  formatDateTimeForApi: formatDateTimeForApiMock,
  getDateInTimezone: getDateInTimezoneMock,
}));

vi.mock("@/application/server-composition-root", () => ({
  serverComposition: {
    ledgerProjections: { createManual: createManualMock },
  },
}));

vi.mock("@/application/orchestration/exchange-rate-ledger-recalculation", () => ({
  initializeExchangeRateLedgerRecalculationOrchestration: vi.fn(),
}));

vi.mock("@/modules/ledger/server/categories", () => ({
  getCategoryName: getEntryCategoryNameMock,
}));

import { createQuickEntry } from "@/modules/source-document/application/use-cases/create-quick-entry";
import type { QuickEntryPorts } from "@/modules/source-document/application/ports";

const ports: QuickEntryPorts = {
  projections: { createManual: createManualMock },
  convertAmount: convertAmountMock,
};

describe("createQuickEntry", () => {
  let randomUuidSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    formatDateTimeForApiMock.mockReturnValue("2026-03-20");
    getEntryCategoryNameMock.mockResolvedValue("Food");
    convertAmountMock.mockImplementation(async (input) => ({
      convertedAmount: input.fromCurrency === input.toCurrency ? "100.00" : "3.67",
      exchangeRate: input.fromCurrency === input.toCurrency ? "1" : "0.146666666667",
    }));
    createManualMock.mockResolvedValue({ sourceDocumentId: "doc-1", revisionId: "revision-1" });
    randomUuidSpy = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValueOnce("entry-1");
  });

  afterEach(() => {
    randomUuidSpy.mockRestore();
  });

  it("uses ledger main currency and current date when payload omits them", async () => {
    const result = await createQuickEntry(
      "ledger-1",
      { settings: { mainCurrency: "USD" } },
      {
        categoryId: "cat-1",
        bookId: "user-1",
        amount: "100",
      },
      ports
    );

    expect(convertAmountMock).toHaveBeenCalledWith({
      amount: "100",
      fromCurrency: "USD",
      toCurrency: "USD",
      date: "2026-03-20",
    });
    expect(createManualMock).toHaveBeenCalledWith({
      ledgerId: "ledger-1",
      bookId: "user-1",
      expectedMainCurrency: "USD",
      title: "Food",
      entryDate: "2026-03-20",
      entries: [
        expect.objectContaining({
          id: "entry-1",
          currency: "USD",
          itemName: "Food",
          convertedAmount: "100.00",
        }),
      ],
    });
    expect(result).toEqual({
      sourceDocumentId: "doc-1",
      ledgerEntryId: "entry-1",
      status: "completed",
    });
  });

  it("dates the record by the signed-in member's own zone", async () => {
    getDateInTimezoneMock.mockReturnValueOnce("2026-03-21");

    await createQuickEntry(
      "ledger-1",
      { settings: { mainCurrency: "USD" } },
      {
        categoryId: "cat-1",
        bookId: "user-1",
        amount: "100",
        timeZone: "Asia/Shanghai",
      },
      ports
    );

    expect(getDateInTimezoneMock).toHaveBeenCalledWith("Asia/Shanghai");
    expect(createManualMock).toHaveBeenCalledWith(
      expect.objectContaining({ entryDate: "2026-03-21" })
    );
  });

  it("uses provided currency, entryDate, itemName, and description", async () => {
    await createQuickEntry(
      "ledger-1",
      { settings: { mainCurrency: "USD" } },
      {
        categoryId: "cat-1",
        bookId: "user-1",
        amount: "25",
        currency: "CNY",
        entryDate: "2026-01-31",
        itemName: "Tea",
        description: "afternoon",
      },
      ports
    );

    expect(convertAmountMock).toHaveBeenCalledWith({
      amount: "25",
      fromCurrency: "CNY",
      toCurrency: "USD",
      date: "2026-01-31",
    });
    expect(createManualMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Tea",
        entryDate: "2026-01-31",
        entries: [
          expect.objectContaining({
            currency: "CNY",
            itemName: "Tea",
            description: "afternoon",
          }),
        ],
      })
    );
  });
});
