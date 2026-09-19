import { describe, expect, it } from "vitest";
import { parseEnhancedStatsInput } from "@/modules/stats/contract-schemas";

const ledgerId = "00000000-0000-4000-8000-000000000001";

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
    expect(() => parseEnhancedStatsInput({ ledgerId, ...ranges })).toThrow(
      expect.objectContaining({ code: "STATS_RANGE_TOO_LARGE", statusCode: 422 })
    );
  });

  it("accepts disjoint ranges no longer than 3660 days", () => {
    expect(
      parseEnhancedStatsInput({
        ledgerId,
        queryRange: { from: "2016-01-03", to: "2026-01-01" },
        compareRange: { from: "2006-01-04", to: "2016-01-02" },
      })
    ).toEqual(expect.objectContaining({ ledgerId }));
  });
});
