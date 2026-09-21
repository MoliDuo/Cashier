/**
 * Geometry for the summary sparkline, kept apart from the component so the
 * rules that are easy to get wrong — how the two periods line up, and what a
 * flat or empty series looks like — can be read and tested on their own.
 *
 * Coordinates are in a 0–100 box that the SVG stretches to its own size.
 */

export interface SparklineGeometry {
  /** Polyline points for this period, empty when there is nothing to draw. */
  current: string;
  /** Polyline points for the comparison period, empty when there is none. */
  previous: string;
  /** Path for the shading under this period's line, empty when there is nothing to draw. */
  area: string;
}

const EMPTY: SparklineGeometry = { current: "", previous: "", area: "" };

export function buildSparklineGeometry(input: {
  current: readonly number[];
  previous: readonly number[];
}): SparklineGeometry {
  const current = [...input.current];
  if (current.length === 0) return EMPTY;

  // The two windows cover different dates — last month's 1st against this
  // month's 1st — so they are read off against each other by position. A
  // comparison window that ran longer has no counterpart for its extra days and
  // is cut; one that ran shorter simply stops early rather than being stretched
  // across a span it did not cover.
  const previous = input.previous.slice(0, current.length);

  const values = [...current, ...previous];
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min;

  const x = (index: number, length: number) => (length === 1 ? 50 : (index / (length - 1)) * 100);
  const y = (value: number) => (range === 0 ? 50 : (1 - (value - min) / range) * 100);
  // A single reading has no shape, so it is drawn as a line across the whole
  // width rather than as a dot the eye would miss.
  const points = (series: readonly number[]) =>
    series.length === 1
      ? `0,${y(series[0]!)} 100,${y(series[0]!)}`
      : series.map((value, index) => `${x(index, series.length)},${y(value)}`).join(" ");

  const currentPoints = points(current);
  const baseline = y(0);
  const firstX = current.length === 1 ? 0 : x(0, current.length);
  const lastX = current.length === 1 ? 100 : x(current.length - 1, current.length);

  return {
    current: currentPoints,
    previous: previous.length === 0 ? "" : points(previous),
    area: `M${firstX},${baseline} L${currentPoints.split(" ").join(" L")} L${lastX},${baseline} Z`,
  };
}
