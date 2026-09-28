import { describe, expect, it } from "vitest";
import { niceScale } from "@/modules/stats/lib/chart-scale";

describe("niceScale", () => {
  it("ends the axis on the lowest round number that holds the largest value", () => {
    expect(niceScale(3032)).toEqual({ max: 4000, ticks: [0, 1000, 2000, 3000, 4000] });
    expect(niceScale(1311)).toEqual({ max: 1500, ticks: [0, 500, 1000, 1500] });
    expect(niceScale(70)).toEqual({ max: 75, ticks: [0, 25, 50, 75] });
    expect(niceScale(3)).toEqual({ max: 3, ticks: [0, 1, 2, 3] });
  });

  it("keeps a flat axis for nothing to show", () => {
    expect(niceScale(0).max).toBe(1);
    expect(niceScale(Number.NaN).ticks).toHaveLength(4);
  });
});
