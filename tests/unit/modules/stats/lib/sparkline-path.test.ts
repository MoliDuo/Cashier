import { describe, expect, it } from "vitest";
import { buildSparklineGeometry } from "@/modules/stats/lib/sparkline-path";

function xs(points: string): number[] {
  return points === "" ? [] : points.split(" ").map((point) => Number(point.split(",")[0]));
}

function ys(points: string): number[] {
  return points === "" ? [] : points.split(" ").map((point) => Number(point.split(",")[1]));
}

describe("buildSparklineGeometry", () => {
  it("draws nothing when this period has no days", () => {
    expect(buildSparklineGeometry({ current: [], previous: [10, 20] })).toEqual({
      current: "",
      previous: "",
      area: "",
    });
  });

  it("spans the width for a single reading instead of leaving a dot", () => {
    const geometry = buildSparklineGeometry({ current: [10], previous: [] });

    expect(xs(geometry.current)).toEqual([0, 100]);
    expect(geometry.previous).toBe("");
  });

  it("cuts a comparison period that ran longer than this one", () => {
    // A 31-day month against a 30-day one: the extra day has nothing to sit
    // beside, so it is dropped rather than squeezing the whole line.
    const geometry = buildSparklineGeometry({ current: [1, 2, 3], previous: [4, 5, 6, 7] });

    expect(xs(geometry.previous)).toEqual([0, 50, 100]);
  });

  it("lets a shorter comparison period stop early rather than stretching it", () => {
    const geometry = buildSparklineGeometry({ current: [1, 2, 3, 4, 5], previous: [4, 5, 6] });

    expect(xs(geometry.previous)).toEqual([0, 50, 100]);
    expect(xs(geometry.current)).toEqual([0, 25, 50, 75, 100]);
  });

  it("measures both periods against one scale so they can be read off each other", () => {
    // Last period's peak is the highest point overall, so it sits at the top
    // and this period's peak sits below it.
    const geometry = buildSparklineGeometry({ current: [0, 50], previous: [0, 100] });

    expect(ys(geometry.previous)).toEqual([100, 0]);
    expect(ys(geometry.current)).toEqual([100, 50]);
  });

  it("puts a flat series down the middle rather than dividing by a zero range", () => {
    const geometry = buildSparklineGeometry({ current: [0, 0, 0], previous: [] });

    expect(ys(geometry.current)).toEqual([50, 50, 50]);
  });

  it("closes the shaded area back to the zero line", () => {
    const geometry = buildSparklineGeometry({ current: [10, 20], previous: [] });

    expect(geometry.area).toBe("M0,100 L0,50 L100,0 L100,100 Z");
  });
});
