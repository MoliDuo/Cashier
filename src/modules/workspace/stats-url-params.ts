export type StatsRange = "week" | "month" | "year";
export type StatsView = "heatmap" | "trend";

export interface StatsUrlState {
  range: StatsRange;
  offset: number;
  view: StatsView;
}

type SearchParamsLike = Pick<URLSearchParams, "get" | "toString">;

const STATS_RANGES = new Set<StatsRange>(["week", "month", "year"]);
const STATS_VIEWS = new Set<StatsView>(["heatmap", "trend"]);
const MIN_STATS_OFFSET: Readonly<Record<StatsRange, number>> = {
  week: -521,
  month: -119,
  year: -9,
};

/** 统计's query: `range`, `offset` (zero or negative) and `view`, each omitted at its default. */
export function readStatsSearchParams(searchParams: Pick<URLSearchParams, "get">): StatsUrlState {
  const rawRange = searchParams.get("range");
  const rawView = searchParams.get("view");
  const rawOffset = searchParams.get("offset");
  const parsedOffset = rawOffset == null ? 0 : Number(rawOffset);

  const range =
    rawRange != null && STATS_RANGES.has(rawRange as StatsRange)
      ? (rawRange as StatsRange)
      : "month";

  return {
    range,
    offset:
      Number.isFinite(parsedOffset) && Number.isInteger(parsedOffset) && parsedOffset <= 0
        ? Math.max(MIN_STATS_OFFSET[range], parsedOffset)
        : 0,
    view:
      rawView != null && STATS_VIEWS.has(rawView as StatsView) ? (rawView as StatsView) : "heatmap",
  };
}

export function setStatsSearchParams(
  current: SearchParamsLike,
  state: StatsUrlState
): URLSearchParams {
  const params = new URLSearchParams(current.toString());
  if (state.range === "month") params.delete("range");
  else params.set("range", state.range);
  if (state.offset === 0) params.delete("offset");
  else {
    const offset = Number.isFinite(state.offset) ? Math.trunc(state.offset) : 0;
    params.set("offset", String(Math.max(MIN_STATS_OFFSET[state.range], Math.min(0, offset))));
  }
  if (state.view === "heatmap") params.delete("view");
  else params.set("view", state.view);
  return params;
}

/** The canonical 统计 query, or null when the current one already is. */
export function normalizeStatsSearchParams(current: SearchParamsLike): URLSearchParams | null {
  const normalized = setStatsSearchParams(current, readStatsSearchParams(current));
  return normalized.toString() === new URLSearchParams(current.toString()).toString()
    ? null
    : normalized;
}
