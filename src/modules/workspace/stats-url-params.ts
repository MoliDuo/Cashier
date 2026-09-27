import { readPeriodParams, writePeriodParams } from "./period-url-params";

export type StatsView = "heatmap" | "trend";

type SearchParamsLike = Pick<URLSearchParams, "get" | "toString">;

/** 统计's own query beyond the shared period: which chart it shows, heatmap by default. */
export function readStatsView(searchParams: Pick<URLSearchParams, "get">): StatsView {
  return searchParams.get("view") === "trend" ? "trend" : "heatmap";
}

export function writeStatsView(current: SearchParamsLike, view: StatsView): URLSearchParams {
  const params = new URLSearchParams(current.toString());
  if (view === "heatmap") params.delete("view");
  else params.set("view", view);
  return params;
}

/** The canonical 统计 query, or null when the current one already is. */
export function normalizeStatsSearchParams(current: SearchParamsLike): URLSearchParams | null {
  const normalized = writeStatsView(
    writePeriodParams(current, readPeriodParams(current)),
    readStatsView(current)
  );
  return normalized.toString() === new URLSearchParams(current.toString()).toString()
    ? null
    : normalized;
}
