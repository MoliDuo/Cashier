import type { SourceDocumentProcessingStatus } from "@/modules/source-document/types";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type SupportedLocale } from "@/i18n/locales";
import { DECIMAL_STRING_PATTERN, normalize as normalizeDecimal } from "@/lib/money/decimal";
import { isValidDateString } from "@/lib/date-utils";

const STATUSES_URL_PARAM = "statuses";
export type LedgerFilterScope = "stream" | "details";
/** Only records have a detail sheet; an entry URL is no longer a valid target
 * and parses to null, so a stale `detailType=ledger-entry` link is dropped. */
type LedgerDetailType = "source-document";
export type StatsRange = "week" | "month" | "year";
export type StatsView = "heatmap" | "trend";

export interface LedgerDetailUrlState {
  detailType: LedgerDetailType;
  detailId: string;
}

export interface StatsUrlState {
  range: StatsRange;
  offset: number;
  view: StatsView;
}
const STATUSES_URL_DELIMITER = ",";

/**
 * Canonical status order for URL serialization.
 * Mirrors SOURCE_DOCUMENT_STATUSES order for stable, predictable encoding.
 */
const CANONICAL_STATUS_ORDER: readonly SourceDocumentProcessingStatus[] = [
  "processing",
  "completed",
  "failed",
  "cancelled",
];

/**
 * Parse a comma-delimited statuses URL parameter into a validated, deduplicated,
 * canonically ordered array. Invalid tokens are silently ignored.
 * Returns an empty array when the parameter is absent, empty, or contains no
 * valid tokens (empty array = all statuses, i.e. no status filtering).
 */
export function parseStatusesParam(raw: string | null): SourceDocumentProcessingStatus[] {
  if (raw == null || raw === "") return [];

  const tokenSet = new Set<SourceDocumentProcessingStatus>();
  const rawTokens = raw.split(STATUSES_URL_DELIMITER);

  for (const token of rawTokens) {
    const trimmed = token.trim();
    if (trimmed === "") continue;
    if ((CANONICAL_STATUS_ORDER as readonly string[]).includes(trimmed)) {
      tokenSet.add(trimmed as SourceDocumentProcessingStatus);
    }
  }

  // Return in canonical order, preserving only known valid tokens
  return CANONICAL_STATUS_ORDER.filter((s) => tokenSet.has(s));
}

/**
 * Serialize a statuses array to a comma-delimited string suitable for URL use.
 * Returns null when the array is empty (parameter should be omitted).
 * The input is already assumed to be canonical; duplicates are removed defensively.
 */
export function formatStatusesParam(statuses: SourceDocumentProcessingStatus[]): string | null {
  if (statuses.length === 0) return null;

  // Deduplicate while preserving canonical order
  const unique = CANONICAL_STATUS_ORDER.filter((s) => statuses.includes(s));

  if (unique.length === 0) return null;

  return unique.join(STATUSES_URL_DELIMITER);
}

export interface LedgerFilterParams {
  categoryId: string | null;
  currency: string | null;
  minAmount: string | null;
  maxAmount: string | null;
  statuses: SourceDocumentProcessingStatus[];
  search: string | null;
}

type SearchParamsLike = Pick<URLSearchParams, "get" | "toString">;
type SearchParamsStringLike = Pick<URLSearchParams, "toString">;

const FILTER_KEYS = [
  "period",
  "startDate",
  "endDate",
  "categoryId",
  "currency",
  "minAmount",
  "maxAmount",
  "statuses",
  "search",
] as const;

type FilterKey = (typeof FILTER_KEYS)[number];

function scopedKey(scope: LedgerFilterScope, key: FilterKey): string {
  return `${scope}${key[0]!.toUpperCase()}${key.slice(1)}`;
}

function readScopedValue(
  searchParams: Pick<URLSearchParams, "get">,
  key: FilterKey,
  scope?: LedgerFilterScope
): string | null {
  if (scope == null) return searchParams.get(key);
  return searchParams.get(scopedKey(scope, key));
}

export function migrateLegacyLedgerSearchParams(
  searchParams: SearchParamsLike,
  scope: LedgerFilterScope
): URLSearchParams | null {
  const params = createMutableSearchParams(searchParams);
  let changed = false;

  for (const key of FILTER_KEYS) {
    const legacyValue = params.get(key);
    if (legacyValue == null) continue;

    const namespacedKey = scopedKey(scope, key);
    if (!params.has(namespacedKey)) params.set(namespacedKey, legacyValue);
    params.delete(key);
    changed = true;
  }

  return changed ? params : null;
}

/** Returns a legacy-shaped view so existing period parsing can share scoped URL state. */
export function getScopedLedgerSearchParams(
  searchParams: SearchParamsLike,
  scope: LedgerFilterScope
): URLSearchParams {
  const scoped = new URLSearchParams(searchParams.toString());
  for (const key of FILTER_KEYS) {
    const value = readScopedValue(searchParams, key, scope);
    if (value == null || value === "") scoped.delete(key);
    else scoped.set(key, value);
  }
  return scoped;
}

export interface LedgerUrlUpdate {
  tab?: string | null;
  period?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  categoryId?: string | null;
  currency?: string | null;
  minAmount?: string | null;
  maxAmount?: string | null;
  statuses?: SourceDocumentProcessingStatus[] | null;
  search?: string | null;
}

const DETAIL_TYPES = new Set<LedgerDetailType>(["source-document"]);
const STATS_RANGES = new Set<StatsRange>(["week", "month", "year"]);
const STATS_VIEWS = new Set<StatsView>(["heatmap", "trend"]);
const MIN_STATS_OFFSET: Readonly<Record<StatsRange, number>> = {
  week: -521,
  month: -119,
  year: -9,
};

export function readLedgerDetailSearchParams(
  searchParams: Pick<URLSearchParams, "get">
): LedgerDetailUrlState | null {
  const detailType = searchParams.get("detailType");
  const detailId = searchParams.get("detailId");
  if (
    detailId == null ||
    detailId === "" ||
    detailType == null ||
    !DETAIL_TYPES.has(detailType as LedgerDetailType)
  ) {
    return null;
  }
  return { detailType: detailType as LedgerDetailType, detailId };
}

export function setLedgerDetailSearchParams(
  current: SearchParamsLike,
  detail: LedgerDetailUrlState | null
): URLSearchParams {
  const params = createMutableSearchParams(current);
  if (detail == null) {
    params.delete("detailType");
    params.delete("detailId");
  } else {
    params.set("detailType", detail.detailType);
    params.set("detailId", detail.detailId);
  }
  return params;
}

export function readStatsSearchParams(searchParams: Pick<URLSearchParams, "get">): StatsUrlState {
  const rawRange = searchParams.get("statsRange");
  const rawView = searchParams.get("statsView");
  const rawOffset = searchParams.get("statsOffset");
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
  const params = createMutableSearchParams(current);
  if (state.range === "month") params.delete("statsRange");
  else params.set("statsRange", state.range);
  if (state.offset === 0) params.delete("statsOffset");
  else {
    const offset = Number.isFinite(state.offset) ? Math.trunc(state.offset) : 0;
    params.set("statsOffset", String(Math.max(MIN_STATS_OFFSET[state.range], Math.min(0, offset))));
  }
  if (state.view === "heatmap") params.delete("statsView");
  else params.set("statsView", state.view);
  return params;
}

export function normalizeLedgerUrlSearchParams(current: SearchParamsLike): URLSearchParams | null {
  const params = createMutableSearchParams(current);
  const detail = readLedgerDetailSearchParams(params);
  const stats = readStatsSearchParams(params);
  let changed = false;

  for (const scope of ["stream", "details"] as const) {
    const periodKey = scopedKey(scope, "period");
    const startKey = scopedKey(scope, "startDate");
    const endKey = scopedKey(scope, "endDate");
    if (params.get(periodKey) !== "custom") continue;
    const start = params.get(startKey);
    const end = params.get(endKey);
    if (
      start == null ||
      end == null ||
      !isValidDateString(start) ||
      !isValidDateString(end) ||
      start > end
    ) {
      params.delete(periodKey);
      params.delete(startKey);
      params.delete(endKey);
      changed = true;
    }
  }

  if (detail == null && (params.has("detailType") || params.has("detailId"))) {
    params.delete("detailType");
    params.delete("detailId");
    changed = true;
  }

  const normalizedStats = setStatsSearchParams(params, stats);
  if (normalizedStats.toString() !== params.toString()) {
    changed = true;
  }
  return changed ? normalizedStats : null;
}

export function buildDetailsDrilldownSearchParams(
  current: SearchParamsLike,
  input: {
    startDate: string;
    endDate: string;
    categoryId?: string | null;
    currency?: string | null;
  }
): URLSearchParams {
  const params = createMutableSearchParams(current);
  for (const key of FILTER_KEYS) params.delete(scopedKey("details", key));

  params.set("tab", "details");
  params.set("detailsPeriod", "custom");
  params.set("detailsStartDate", input.startDate);
  params.set("detailsEndDate", input.endDate);
  if (input.categoryId != null && input.categoryId !== "") {
    params.set("detailsCategoryId", input.categoryId);
  }
  if (input.currency != null && input.currency !== "") {
    params.set("detailsCurrency", input.currency);
  }
  return params;
}

function createMutableSearchParams(searchParams: SearchParamsLike): URLSearchParams {
  return new URLSearchParams(searchParams.toString());
}

function setOrDeleteStringParam(
  params: URLSearchParams,
  key: string,
  value: string | null | undefined
) {
  const isEmpty = value == null || value === "";

  if (isEmpty) {
    params.delete(key);
    return;
  }

  params.set(key, value);
}

function setOrDeleteDecimalParam(
  params: URLSearchParams,
  key: string,
  value: string | null | undefined
) {
  if (value == null || !DECIMAL_STRING_PATTERN.test(value) || value.startsWith("-")) {
    params.delete(key);
    return;
  }

  params.set(key, normalizeDecimal(value));
}

export function readLedgerFilterParams(
  searchParams: SearchParamsLike,
  scope?: LedgerFilterScope
): LedgerFilterParams {
  const readDecimal = (key: "minAmount" | "maxAmount"): string | null => {
    const raw = readScopedValue(searchParams, key, scope);
    if (raw == null || raw.trim() === "") return null;
    const trimmed = raw.trim();
    return DECIMAL_STRING_PATTERN.test(trimmed) && !trimmed.startsWith("-")
      ? normalizeDecimal(trimmed)
      : null;
  };

  return {
    categoryId: readScopedValue(searchParams, "categoryId", scope),
    currency: readScopedValue(searchParams, "currency", scope),
    minAmount: readDecimal("minAmount"),
    maxAmount: readDecimal("maxAmount"),
    statuses: parseStatusesParam(readScopedValue(searchParams, STATUSES_URL_PARAM, scope)),
    search: readScopedValue(searchParams, "search", scope),
  };
}

export function updateLedgerSearchParams(
  searchParams: SearchParamsLike,
  updates: LedgerUrlUpdate,
  scope?: LedgerFilterScope
): URLSearchParams {
  const params = createMutableSearchParams(searchParams);

  const keyFor = (key: FilterKey) => (scope == null ? key : scopedKey(scope, key));

  if ("tab" in updates) setOrDeleteStringParam(params, "tab", updates.tab);
  if ("period" in updates) {
    setOrDeleteStringParam(params, keyFor("period"), updates.period);

    if (updates.period !== "custom") {
      params.delete(keyFor("startDate"));
      params.delete(keyFor("endDate"));
    }
  }

  if (
    updates.period === "custom" ||
    (!("period" in updates) && ("startDate" in updates || "endDate" in updates))
  ) {
    if ("startDate" in updates)
      setOrDeleteStringParam(params, keyFor("startDate"), updates.startDate);
    if ("endDate" in updates) setOrDeleteStringParam(params, keyFor("endDate"), updates.endDate);
  }

  if ("categoryId" in updates)
    setOrDeleteStringParam(params, keyFor("categoryId"), updates.categoryId);
  if ("currency" in updates) setOrDeleteStringParam(params, keyFor("currency"), updates.currency);
  if ("minAmount" in updates)
    setOrDeleteDecimalParam(params, keyFor("minAmount"), updates.minAmount);
  if ("maxAmount" in updates)
    setOrDeleteDecimalParam(params, keyFor("maxAmount"), updates.maxAmount);

  if ("statuses" in updates) {
    const formatted = updates.statuses != null ? formatStatusesParam(updates.statuses) : null;
    if (formatted != null) {
      params.set(keyFor(STATUSES_URL_PARAM), formatted);
    } else {
      params.delete(keyFor(STATUSES_URL_PARAM));
    }
  }
  if ("search" in updates) setOrDeleteStringParam(params, keyFor("search"), updates.search);

  return params;
}

export function buildLedgerUrl(
  pathname: string,
  searchParams: SearchParamsStringLike | URLSearchParams,
  locale: string
): string {
  const supportedLocale = SUPPORTED_LOCALES.includes(locale as SupportedLocale)
    ? (locale as SupportedLocale)
    : DEFAULT_LOCALE;
  const normalizedPathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const segments = normalizedPathname.split("/");
  const localizedPathname = SUPPORTED_LOCALES.includes(segments[1] as SupportedLocale)
    ? ["", supportedLocale, ...segments.slice(2)].join("/")
    : `/${supportedLocale}${normalizedPathname === "/" ? "" : normalizedPathname}`;
  const query = searchParams.toString();
  return query === "" ? localizedPathname : `${localizedPathname}?${query}`;
}
