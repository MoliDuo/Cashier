import { describe, expect, it } from "vitest";
import { parseEnhancedStatsInput } from "@/modules/stats/contract-schemas";

describe("parseEnhancedStatsInput", () => {
  it.each([
    {
      queryRange: { from: "2015-01-01", to: "2026-01-01" },
      compareRange: { from: "2000-01-01", to: "2000-01-02" },
    },
    {
      queryRange: { from: "2026-01-01", to: "2026-01-31" },
      compareRange: { from: "2026-01-31", to: "2026-02-28" },
    },
  ])("rejects oversized or overlapping ranges", (ranges) => {
    expect(() => parseEnhancedStatsInput(ranges)).toThrow(
      expect.objectContaining({ code: "STATS_RANGE_TOO_LARGE", statusCode: 422 })
    );
  });

  it("accepts disjoint ranges no longer than 3660 days", () => {
    expect(
      parseEnhancedStatsInput({
        queryRange: { from: "2016-01-03", to: "2026-01-01" },
        compareRange: { from: "2006-01-04", to: "2016-01-02" },
      })
    ).toEqual(expect.objectContaining({ queryRange: { from: "2016-01-03", to: "2026-01-01" } }));
  });

  it("reads a running month's previous month to its end, but not into this one", () => {
    const running = {
      queryRange: { from: "2026-10-01", to: "2026-10-10" },
      compareRange: { from: "2026-09-01", to: "2026-09-10" },
      periodEnd: "2026-10-31",
      previousWholeTo: "2026-09-30",
    };
    expect(parseEnhancedStatsInput(running)).toMatchObject(running);

    expect(() => parseEnhancedStatsInput({ ...running, previousWholeTo: "2026-10-02" })).toThrow(
      expect.objectContaining({ code: "STATS_RANGE_TOO_LARGE" })
    );
  });

  it("refuses a period that ends before its own days", () => {
    expect(() =>
      parseEnhancedStatsInput({
        queryRange: { from: "2026-10-01", to: "2026-10-10" },
        compareRange: { from: "2026-09-01", to: "2026-09-10" },
        periodEnd: "2026-10-05",
      })
    ).toThrow(expect.objectContaining({ name: "ValidationError" }));
  });
});
