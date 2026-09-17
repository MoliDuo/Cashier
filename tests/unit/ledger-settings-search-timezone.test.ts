import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseBatchUpdateLedgerEntriesInput,
  parseBatchUpdateLedgerEntryDatesInput,
  parseUpdateEntryCategoryInput,
  parseUpdateLedgerEntryInput,
  parseUpdateLedgerInput,
} from "@/modules/ledger/contract-schemas";
import { parseUpdateMyProfileInput } from "@/modules/auth/profile-schemas";
import { normalizeSearchTerm } from "@/lib/search";
import { periodToDateRange } from "@/lib/period-utils";

describe("ledger settings, search, and time zones", () => {
  const expectedUpdatedAt = "2026-01-01T00:00:00.000Z";
  afterEach(() => vi.useRealTimers());

  it("keeps the ledger's own settings free of a time zone", () => {
    // The zone belongs to a person now, so the ledger update must not take one.
    expect(() =>
      parseUpdateLedgerInput({ expectedUpdatedAt, settings: { timeZone: "America/New_York" } })
    ).toThrow("Validation failed");
  });

  it("accepts automatic and valid IANA time zones on a profile and rejects invalid values", () => {
    expect(
      parseUpdateMyProfileInput({ nickname: "A", gender: "male", timeZone: null }).timeZone
    ).toBeNull();
    expect(
      parseUpdateMyProfileInput({
        nickname: "A",
        gender: "male",
        timeZone: "America/New_York",
      }).timeZone
    ).toBe("America/New_York");
    expect(() =>
      parseUpdateMyProfileInput({ nickname: "A", gender: "male", timeZone: "Mars/Olympus" })
    ).toThrow("Validation failed");
    expect(() =>
      parseUpdateMyProfileInput({
        nickname: "A",
        gender: "male",
        timeZone: "A".repeat(51),
      })
    ).toThrow("Validation failed");
  });

  it("accepts the optional default-collapse preference", () => {
    expect(
      parseUpdateLedgerInput({ expectedUpdatedAt, settings: { collapseEntriesDefault: true } })
        .settings?.collapseEntriesDefault
    ).toBe(true);
    expect(() => parseUpdateLedgerInput({ expectedUpdatedAt, settings: {} })).toThrow(
      "Validation failed"
    );
  });

  it("normalizes currencies and rejects oversized or empty updates", () => {
    expect(
      parseUpdateLedgerInput({ expectedUpdatedAt, settings: { mainCurrency: " usd " } }).settings
        ?.mainCurrency
    ).toBe("USD");
    expect(() =>
      parseUpdateLedgerInput({ expectedUpdatedAt, settings: { aiCustomPrompt: "x".repeat(4001) } })
    ).toThrow("Validation failed");
    expect(() => parseUpdateLedgerInput({ expectedUpdatedAt })).toThrow("Validation failed");
    expect(() => parseUpdateEntryCategoryInput({})).toThrow("Validation failed");
    expect(() => parseUpdateLedgerEntryInput({})).toThrow("Validation failed");
    expect(() => parseBatchUpdateLedgerEntriesInput({})).toThrow("Validation failed");
  });

  it("validates batch date input", () => {
    const entryId = "00000000-0000-4000-8000-000000000001";
    expect(() =>
      parseBatchUpdateLedgerEntryDatesInput({
        entryIds: [entryId],
        entryDate: "2026-8-1",
      })
    ).toThrow("Validation failed");
  });

  it("normalizes whitespace and caps search terms", () => {
    expect(normalizeSearchTerm("  Coffee\n\tReceipt  ")).toBe("Coffee Receipt");
    expect(normalizeSearchTerm("   ")).toBeUndefined();
    expect(normalizeSearchTerm("x".repeat(150))).toHaveLength(100);
  });

  it("anchors this month in the selected time zone across midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T16:30:00.000Z"));

    expect(periodToDateRange({ period: "thisMonth" }, "Asia/Shanghai")).toEqual({
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    expect(periodToDateRange({ period: "thisMonth" }, "America/New_York")).toEqual({
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    });
  });
});
