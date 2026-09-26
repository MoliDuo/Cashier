import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addPeriod,
  formatCivilDate,
  formatDateTimeForApi,
  formatInstantDateLabel,
  formatRelativeDateLabel,
  getDateRange,
  isValidDateString,
  parseDateRangeEnd,
  parseDateRangeStart,
  parseDateString,
} from "@/lib/date-utils";

describe("date-utils", () => {
  it("derives complete calendar ranges", () => {
    const cases = [
      ["week", "2026-02-02", "2026-02-08"],
      ["month", "2026-02-01", "2026-02-28"],
      ["year", "2026-01-01", "2026-12-31"],
    ] as const;

    for (const [period, expectedStart, expectedEnd] of cases) {
      const { startDate, endDate } = getDateRange(new Date(2026, 1, 4), period);
      expect(formatDateTimeForApi(startDate)).toBe(expectedStart);
      expect(formatDateTimeForApi(endDate)).toBe(expectedEnd);
    }
  });

  it("moves dates by positive and negative calendar periods", () => {
    const date = new Date(2026, 1, 4);
    const cases = [
      ["week", 2, "2026-02-18"],
      ["month", 1, "2026-03-04"],
      ["month", -1, "2026-01-04"],
      ["year", 1, "2027-02-04"],
    ] as const;

    for (const [period, amount, expected] of cases) {
      expect(formatDateTimeForApi(addPeriod(date, period, amount))).toBe(expected);
    }
  });

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

  it("parses query boundaries at the start and end of the local day", () => {
    const start = parseDateRangeStart("2026-02-04T15:30:00Z");
    const end = parseDateRangeEnd("2026-02-04");

    expect(start).not.toBeNull();
    expect([start!.getHours(), start!.getMinutes(), start!.getSeconds()]).toEqual([0, 0, 0]);
    expect(end).not.toBeNull();
    expect([end!.getHours(), end!.getMinutes(), end!.getSeconds()]).toEqual([23, 59, 59]);
  });

  it("returns null for missing or invalid query boundaries", () => {
    for (const value of [null, undefined, "not-a-date"]) {
      expect(parseDateRangeStart(value)).toBeNull();
      expect(parseDateRangeEnd(value)).toBeNull();
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
