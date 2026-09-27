import { describe, expect, it } from "vitest";
import {
  normalizeStatsSearchParams,
  readStatsView,
  writeStatsView,
} from "@/modules/workspace/stats-url-params";

describe("stats-url-params", () => {
  it("defaults to the heatmap and omits it from the URL", () => {
    expect(readStatsView(new URLSearchParams())).toBe("heatmap");
    expect(readStatsView(new URLSearchParams("view=trend"))).toBe("trend");
    expect(writeStatsView(new URLSearchParams("view=trend"), "heatmap").toString()).toBe("");
  });

  it("rewrites a query it cannot read into the canonical one", () => {
    expect(
      normalizeStatsSearchParams(new URLSearchParams("range=decade&offset=2&view=pie"))?.toString()
    ).toBe("");
    expect(normalizeStatsSearchParams(new URLSearchParams("range=year&offset=-1"))).toBeNull();
  });

  it("reads 统计's old links through the shared period", () => {
    expect(normalizeStatsSearchParams(new URLSearchParams("period=lastMonth"))?.toString()).toBe(
      "offset=-1"
    );
  });
});
