import { describe, expect, it } from "vitest";
import {
  normalizeStatsSearchParams,
  readStatsSearchParams,
  setStatsSearchParams,
} from "@/modules/workspace/stats-url-params";

describe("stats-url-params", () => {
  it("defaults to this month's heatmap", () => {
    expect(readStatsSearchParams(new URLSearchParams())).toEqual({
      range: "month",
      offset: 0,
      view: "heatmap",
    });
  });

  it.each([
    ["week", -999, -521],
    ["month", -999, -119],
    ["year", -999, -9],
  ] as const)("clamps %s stats offsets to the supported history", (range, offset, expected) => {
    expect(
      readStatsSearchParams(new URLSearchParams(`range=${range}&offset=${offset}`)).offset
    ).toBe(expected);
  });

  it.each(["1", "1.5", "Infinity", "-Infinity", "NaN"])(
    "normalizes invalid stats offset %s to zero",
    (offset) => {
      expect(readStatsSearchParams(new URLSearchParams(`offset=${offset}`)).offset).toBe(0);
    }
  );

  it("clamps stats offsets when serializing URL state", () => {
    const params = setStatsSearchParams(new URLSearchParams(), {
      range: "year",
      offset: -100,
      view: "trend",
    });
    expect(params.get("offset")).toBe("-9");
  });

  it("rewrites a query it cannot read into the canonical one", () => {
    expect(
      normalizeStatsSearchParams(new URLSearchParams("range=decade&offset=2"))?.toString()
    ).toBe("");
    expect(normalizeStatsSearchParams(new URLSearchParams("range=year&offset=-1"))).toBeNull();
  });
});
