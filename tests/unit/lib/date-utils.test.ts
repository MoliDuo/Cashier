import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatCivilDate,
  formatDateTimeForApi,
  formatInstantDateLabel,
  formatRelativeDateLabel,
  isValidDateString,
  parseDateString,
} from "@/lib/date-utils";

describe("date-utils", () => {
  it("formats API dates from local calendar fields", () => {
    expect(formatDateTimeForApi(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(formatDateTimeForApi(undefined)).toBeUndefined();
  });

  it("keeps civil dates stable across runtime timezones", () => {
    const originalTimeZone = process.env.TZ;
    try {
      for (const timeZone of ["UTC", "Asia/Shanghai", "America/Los_Angeles"]) {
        process.env.TZ = timeZone;
        expect(
          formatCivilDate("2026-07-28", "en-US", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          })
        ).toBe("07/28/2026");
      }
    } finally {
      if (originalTimeZone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimeZone;
    }
  });

  it("rejects malformed and impossible civil dates", () => {
    for (const value of ["2026-7-28", "2026-02-30"]) {
      expect(() => formatCivilDate(value, "en-US", {})).toThrow(RangeError);
    }
  });

  it("parses and validates strict date-only values", () => {
    const parsed = parseDateString("2026-03-18");
    expect([parsed.getFullYear(), parsed.getMonth(), parsed.getDate()]).toEqual([2026, 2, 18]);
    expect(isValidDateString("2026-03-18")).toBe(true);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("2026-3-18")).toBe(false);
  });
});

describe("formatRelativeDateLabel", () => {
  // An absolute instant, so the assertions below hold in any runtime timezone.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-11T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("names today and yesterday", () => {
    expect(formatRelativeDateLabel("2026-09-11", "en-US")).toBe("今天");
    expect(formatRelativeDateLabel("2026-09-10", "en-US")).toBe("昨天");
  });

  it("resolves today in the requested timezone", () => {
    expect(formatRelativeDateLabel("2026-09-11", "en-US", "UTC")).toBe("今天");
    expect(formatRelativeDateLabel("2026-09-11", "en-US", "Pacific/Kiritimati")).toBe("昨天");
  });

  it("writes an older day out in full, weekday and year included", () => {
    expect(formatRelativeDateLabel("2026-07-15", "zh")).toBe("2026年7月15日 星期三");
  });

  it("labels a timestamp by the day it falls on", () => {
    expect(formatInstantDateLabel("2026-09-11T02:00:00.000Z", "en-US", "UTC")).toBe("今天");
    expect(formatInstantDateLabel("2026-09-11T02:00:00.000Z", "en-US", "Pacific/Kiritimati")).toBe(
      "昨天"
    );
    expect(formatInstantDateLabel("2026-07-15T02:00:00.000Z", "zh", "UTC")).toBe(
      "2026年7月15日 星期三"
    );
  });

  it("returns malformed input unchanged", () => {
    expect(formatRelativeDateLabel("not-a-date", "en-US")).toBe("not-a-date");
  });
});
