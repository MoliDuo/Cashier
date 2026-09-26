import { describe, expect, it } from "vitest";
import {
  ledgerStatsQuerySchema,
  parseListLedgerEntriesInput,
} from "@/modules/ledger/contract-schemas";

describe("search param validation", () => {
  it("normalizes search in listLedgerEntriesInputSchema", () => {
    expect(parseListLedgerEntriesInput({ search: "  coffee   receipt " }).search).toBe(
      "coffee receipt"
    );
  });

  it("normalizes search in ledgerStatsQuerySchema", () => {
    expect(ledgerStatsQuerySchema.parse({ search: " grocery " }).search).toBe("grocery");
  });

  it("continues to accept supported filter params", () => {
    const entries = parseListLedgerEntriesInput({
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      categoryId: "11111111-1111-4111-8111-111111111111",
      currency: "USD",
      minAmount: "10",
      maxAmount: "50",
      limit: "20",
    });

    expect(entries).toMatchObject({
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      categoryId: "11111111-1111-4111-8111-111111111111",
      currency: "USD",
      minAmount: "10",
      maxAmount: "50",
      limit: 20,
    });

    expect(
      ledgerStatsQuerySchema.parse({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        categoryId: "11111111-1111-4111-8111-111111111111",
        currency: "USD",
      })
    ).toMatchObject({
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      categoryId: "11111111-1111-4111-8111-111111111111",
      currency: "USD",
    });
  });

  it("accepts the uncategorized sentinel but rejects other non-UUID categories", () => {
    expect(parseListLedgerEntriesInput({ categoryId: "__uncategorized__" }).categoryId).toBe(
      "__uncategorized__"
    );
    expect(() => parseListLedgerEntriesInput({ categoryId: "not-a-category" })).toThrow();
  });

  it("preserves decimal precision and normalizes currency", () => {
    expect(
      parseListLedgerEntriesInput({
        currency: " usd ",
        minAmount: "9007199254740993.00",
        maxAmount: "9007199254740993.50",
      })
    ).toMatchObject({
      currency: "USD",
      minAmount: "9007199254740993",
      maxAmount: "9007199254740993.5",
    });
  });

  it("rejects reversed ranges and unknown fields while accepting signed amount filters", () => {
    expect(() =>
      parseListLedgerEntriesInput({ startDate: "2026-04-01", endDate: "2026-03-01" })
    ).toThrow();
    expect(() => ledgerStatsQuerySchema.parse({ minAmount: "20", maxAmount: "10" })).toThrow();
    expect(ledgerStatsQuerySchema.parse({ minAmount: "-1" })).toMatchObject({ minAmount: "-1" });
    expect(() => ledgerStatsQuerySchema.parse({ mainCurrency: "USD" })).toThrow();
  });
});
