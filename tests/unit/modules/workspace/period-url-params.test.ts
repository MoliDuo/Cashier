import { describe, expect, it } from "vitest";
import {
  normalizePeriodSearchParams,
  periodQuery,
  readPeriodParams,
  writePeriodParams,
} from "@/modules/workspace/period-url-params";

describe("period-url-params", () => {
  it("defaults to this month and writes it as nothing", () => {
    expect(readPeriodParams(new URLSearchParams())).toEqual({ range: "month", offset: 0 });
    expect(periodQuery({ range: "month", offset: 0 }).toString()).toBe("");
  });

  it("round-trips every kind of period", () => {
    for (const period of [
      { range: "week", offset: -2 },
      { range: "year", offset: -1 },
      { range: "month", offset: 3 },
      { range: "all" },
      { range: "custom", from: "2026-09-01", to: "2026-09-10" },
    ] as const) {
      expect(readPeriodParams(periodQuery(period))).toEqual(period);
    }
  });

  it("replaces a query's period and keeps its filters", () => {
    const params = writePeriodParams(new URLSearchParams("range=all&categoryId=cat-1"), {
      range: "month",
      offset: -1,
    });
    expect(params.get("categoryId")).toBe("cat-1");
    expect(params.get("range")).toBeNull();
    expect(params.get("offset")).toBe("-1");
  });

  it("rewrites an unreadable period into the canonical query", () => {
    expect(
      normalizePeriodSearchParams(
        new URLSearchParams("range=custom&from=2026-09-10&to=2026-09-01")
      )?.toString()
    ).toBe("");
    expect(normalizePeriodSearchParams(new URLSearchParams("offset=-1"))).toBeNull();
  });
});
