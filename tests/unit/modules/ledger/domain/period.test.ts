import { describe, expect, it } from "vitest";
import {
  calendarRangeOf,
  parsePeriod,
  periodKey,
  resolveComparison,
  resolvePeriod,
  stepPeriod,
} from "@/modules/ledger/domain/period";

describe("calendar periods", () => {
  it("reads a week from Monday to Sunday", () => {
    // 2026-09-27 is a Sunday.
    expect(calendarRangeOf("week", "2026-09-27")).toEqual({ from: "2026-09-21", to: "2026-09-27" });
    expect(calendarRangeOf("week", "2026-09-21")).toEqual({ from: "2026-09-21", to: "2026-09-27" });
  });

  it("reads whole months and years, leap day included", () => {
    expect(calendarRangeOf("month", "2028-02-10")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
    expect(calendarRangeOf("year", "2026-09-27")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("steps back across a year boundary", () => {
    expect(resolvePeriod({ range: "month", offset: -9 }, "2026-09-27")).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
    expect(resolvePeriod({ range: "week", offset: -39 }, "2026-09-27")).toEqual({
      from: "2025-12-22",
      to: "2025-12-28",
    });
    expect(resolvePeriod({ range: "year", offset: -1 }, "2026-01-01")).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
    });
  });

  it("reads everything as no bounds and a named range as itself", () => {
    expect(resolvePeriod({ range: "all" }, "2026-09-27")).toBeNull();
    expect(
      resolvePeriod({ range: "custom", from: "2026-09-01", to: "2026-09-10" }, "2026-09-27")
    ).toEqual({ from: "2026-09-01", to: "2026-09-10" });
  });

  it("steps only calendar periods, never past the current one", () => {
    expect(stepPeriod({ range: "month", offset: 0 }, 1)).toEqual({ range: "month", offset: 0 });
    expect(stepPeriod({ range: "month", offset: 0 }, -1)).toEqual({ range: "month", offset: -1 });
    expect(stepPeriod({ range: "all" }, -1)).toEqual({ range: "all" });
  });
});

describe("comparison windows", () => {
  it("cuts the current month at today and the month before at the same day", () => {
    expect(resolveComparison({ range: "month", offset: 0 }, "2026-03-30")).toEqual({
      range: { from: "2026-03-01", to: "2026-03-30" },
      // February has fewer days, so its window stops at its own end.
      compareRange: { from: "2026-02-01", to: "2026-02-28" },
      mode: "same_period",
      periodEnd: "2026-03-31",
      previousWholeTo: "2026-02-28",
    });
  });

  it("reads a running month's comparison on to the previous month's own end", () => {
    // Totals are set against the first ten days of September; the chart and the
    // forecast still see where September ended up.
    expect(resolveComparison({ range: "month", offset: 0 }, "2026-10-10")).toMatchObject({
      range: { from: "2026-10-01", to: "2026-10-10" },
      compareRange: { from: "2026-09-01", to: "2026-09-10" },
      periodEnd: "2026-10-31",
      previousWholeTo: "2026-09-30",
    });
  });

  it("compares a past period with the whole one before it", () => {
    expect(resolveComparison({ range: "week", offset: -1 }, "2026-09-27")).toEqual({
      range: { from: "2026-09-14", to: "2026-09-20" },
      compareRange: { from: "2026-09-07", to: "2026-09-13" },
      mode: "full_period",
      periodEnd: "2026-09-20",
      previousWholeTo: "2026-09-13",
    });
  });

  it("compares a named range with as many days just before it", () => {
    expect(
      resolveComparison({ range: "custom", from: "2026-09-11", to: "2026-09-20" }, "2026-09-27")
    ).toEqual({
      range: { from: "2026-09-11", to: "2026-09-20" },
      compareRange: { from: "2026-09-01", to: "2026-09-10" },
      mode: "full_period",
      periodEnd: "2026-09-20",
      previousWholeTo: "2026-09-10",
    });
  });

  it("reads everything from the first record to today, capped at ten years", () => {
    expect(resolveComparison({ range: "all" }, "2026-09-27", "2026-01-05").range).toEqual({
      from: "2026-01-05",
      to: "2026-09-27",
    });
    expect(resolveComparison({ range: "all" }, "2026-09-27", null).range).toEqual({
      from: "2026-09-27",
      to: "2026-09-27",
    });
    expect(resolveComparison({ range: "all" }, "2026-09-27", "1990-01-01").range.from).toBe(
      "2016-09-20"
    );
  });
});

describe("parsePeriod", () => {
  it("defaults to this month and rejects what it cannot read", () => {
    expect(parsePeriod({})).toEqual({ range: "month", offset: 0 });
    expect(parsePeriod({ range: "fortnight" })).toEqual({ range: "month", offset: 0 });
    expect(parsePeriod({ range: "month", offset: "2" })).toEqual({ range: "month", offset: 0 });
    expect(parsePeriod({ range: "custom", from: "2026-09-10", to: "2026-09-01" })).toEqual({
      range: "month",
      offset: 0,
    });
    expect(parsePeriod({ range: "custom", from: "2026-02-30", to: "2026-03-01" })).toEqual({
      range: "month",
      offset: 0,
    });
  });

  it("clamps an offset to ten years back", () => {
    expect(parsePeriod({ range: "year", offset: "-40" })).toEqual({ range: "year", offset: -9 });
  });

  it("keys equal periods equally", () => {
    expect(periodKey(parsePeriod({ range: "week", offset: "-2" }))).toBe("week:-2");
    expect(periodKey({ range: "custom", from: "2026-09-01", to: "2026-09-02" })).toBe(
      "custom:2026-09-01:2026-09-02"
    );
  });
});
