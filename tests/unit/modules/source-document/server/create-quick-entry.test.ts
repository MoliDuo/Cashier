import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  formatDateTimeForApiMock,
  getDateInTimezoneMock,
  getEntryCategoryNameMock,
  createManualMock,
  ensureRatesMock,
} = vi.hoisted(() => ({
  formatDateTimeForApiMock: vi.fn(),
  getDateInTimezoneMock: vi.fn<() => string | undefined>(() => undefined),
  getEntryCategoryNameMock: vi.fn(),
  createManualMock: vi.fn(),
  ensureRatesMock: vi.fn(),
}));

vi.mock("@/lib/date-utils", () => ({
  formatDateTimeForApi: formatDateTimeForApiMock,
  getDateInTimezone: getDateInTimezoneMock,
}));

vi.mock("@/modules/source-document/server/projections/writes", () => ({
  createManualDocument: createManualMock,
}));

vi.mock("@/modules/currency/server/exchange-rates", () => ({
  ensureExchangeRates: ensureRatesMock,
}));

vi.mock("@/modules/ledger/server/categories", () => ({
  getCategoryName: getEntryCategoryNameMock,
}));

import { createQuickEntry } from "@/modules/source-document/server/create-quick-entry";

describe("createQuickEntry", () => {
  let randomUuidSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    formatDateTimeForApiMock.mockReturnValue("2026-03-20");
    getEntryCategoryNameMock.mockResolvedValue("Food");
    ensureRatesMock.mockResolvedValue(undefined);
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
      }
    );

    expect(ensureRatesMock).not.toHaveBeenCalled();
    expect(createManualMock).toHaveBeenCalledWith({
      ledgerId: "ledger-1",
      bookId: "user-1",
      title: "Food",
      entryDate: "2026-03-20",
      entries: [
        expect.objectContaining({
          id: "entry-1",
          currency: "USD",
          itemName: "Food",
          amount: "100.00",
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
      }
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
      }
    );

    expect(ensureRatesMock).toHaveBeenCalledWith(["2026-01-31"]);
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
