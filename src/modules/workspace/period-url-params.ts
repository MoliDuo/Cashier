import { DEFAULT_PERIOD, parsePeriod, type Period } from "@/modules/ledger/domain/period";

/**
 * The period every ledger route carries in its URL, under the same four names:
 * `range` (week, month, year, all or custom; month is omitted), `offset` (zero
 * or negative; zero is omitted), and `from` / `to` for a custom range.
 */
export const PERIOD_URL_KEYS = ["range", "offset", "from", "to"] as const;

/** The names older links used: 流水 and 明细's presets and 统计's own. */
const LEGACY_PERIOD_KEYS = ["period", "startDate", "endDate"] as const;

type SearchParamsLike = Pick<URLSearchParams, "get">;

function legacyPeriod(params: SearchParamsLike): Period | null {
  const period = params.get("period");
  if (period == null) return null;
  switch (period) {
    case "all":
      return { range: "all" };
    case "lastMonth":
      return { range: "month", offset: -1 };
    case "custom":
      return parsePeriod({
        range: "custom",
        from: params.get("startDate"),
        to: params.get("endDate"),
      });
    default:
      // thisMonth, and the rolling windows the panel stopped offering.
      return DEFAULT_PERIOD;
  }
}

export function readPeriodParams(params: SearchParamsLike): Period {
  if (params.get("range") == null) {
    const legacy = legacyPeriod(params);
    if (legacy != null) return legacy;
  }
  return parsePeriod({
    range: params.get("range"),
    offset: params.get("offset"),
    from: params.get("from"),
    to: params.get("to"),
  });
}

/** Writes a period into a query, replacing whatever period it named before. */
export function writePeriodParams(
  current: Pick<URLSearchParams, "toString">,
  period: Period
): URLSearchParams {
  const params = new URLSearchParams(current.toString());
  for (const key of [...PERIOD_URL_KEYS, ...LEGACY_PERIOD_KEYS]) params.delete(key);
  if (period.range === "all") params.set("range", "all");
  else if (period.range === "custom") {
    params.set("range", "custom");
    params.set("from", period.from);
    params.set("to", period.to);
  } else {
    if (period.range !== "month") params.set("range", period.range);
    if (period.offset !== 0) params.set("offset", String(period.offset));
  }
  return params;
}

/** Just the period part of a query, for carrying it to another route. */
export function periodQuery(period: Period): URLSearchParams {
  return writePeriodParams(new URLSearchParams(), period);
}

/** The canonical form of a query's period, or null when it already is. */
export function normalizePeriodSearchParams(
  current: Pick<URLSearchParams, "get" | "toString">
): URLSearchParams | null {
  const normalized = writePeriodParams(current, readPeriodParams(current));
  return normalized.toString() === new URLSearchParams(current.toString()).toString()
    ? null
    : normalized;
}
