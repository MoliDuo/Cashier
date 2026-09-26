import type { SourceDocumentProcessingStatus } from "@/modules/source-document/types";
import { DECIMAL_STRING_PATTERN, normalize as normalizeDecimal } from "@/lib/money/decimal";
import { isValidDateString } from "@/lib/date-utils";

/**
 * The filters 流水 and 明细 carry in their URLs. Each route owns its own query
 * string, so the two share these names without a prefix and cannot collide.
 */
const STATUSES_URL_PARAM = "statuses";
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

/** Every query key 流水 and 明细 read their filters from. */
export const LEDGER_FILTER_KEYS = [
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

export interface LedgerUrlUpdate {
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

/**
 * Drops a custom period that cannot be read — a missing or reversed bound — so
 * the page falls back to its default period instead of an empty one. Returns
 * null when the query is already canonical.
 */
export function normalizeLedgerFilterSearchParams(
  current: SearchParamsLike
): URLSearchParams | null {
  const params = createMutableSearchParams(current);
  if (params.get("period") !== "custom") return null;
  const start = params.get("startDate");
  const end = params.get("endDate");
  if (
    start != null &&
    end != null &&
    isValidDateString(start) &&
    isValidDateString(end) &&
    start <= end
  ) {
    return null;
  }
  params.delete("period");
  params.delete("startDate");
  params.delete("endDate");
  return params;
}

/** The 明细 query a drilldown lands on: a date range, and optionally a category or currency. */
export function buildDetailsDrilldownSearchParams(input: {
  startDate: string;
  endDate: string;
  categoryId?: string | null;
  currency?: string | null;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set("period", "custom");
  params.set("startDate", input.startDate);
  params.set("endDate", input.endDate);
  if (input.categoryId != null && input.categoryId !== "") {
    params.set("categoryId", input.categoryId);
  }
  if (input.currency != null && input.currency !== "") {
    params.set("currency", input.currency);
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
  searchParams: Pick<URLSearchParams, "get">
): LedgerFilterParams {
  const readDecimal = (key: "minAmount" | "maxAmount"): string | null => {
    const raw = searchParams.get(key);
    if (raw == null || raw.trim() === "") return null;
    const trimmed = raw.trim();
    return DECIMAL_STRING_PATTERN.test(trimmed) && !trimmed.startsWith("-")
      ? normalizeDecimal(trimmed)
      : null;
  };

  return {
    categoryId: searchParams.get("categoryId"),
    currency: searchParams.get("currency"),
    minAmount: readDecimal("minAmount"),
    maxAmount: readDecimal("maxAmount"),
    statuses: parseStatusesParam(searchParams.get(STATUSES_URL_PARAM)),
    search: searchParams.get("search"),
  };
}

export function updateLedgerSearchParams(
  searchParams: SearchParamsLike,
  updates: LedgerUrlUpdate
): URLSearchParams {
  const params = createMutableSearchParams(searchParams);

  if ("period" in updates) {
    setOrDeleteStringParam(params, "period", updates.period);

    if (updates.period !== "custom") {
      params.delete("startDate");
      params.delete("endDate");
    }
  }

  if (
    updates.period === "custom" ||
    (!("period" in updates) && ("startDate" in updates || "endDate" in updates))
  ) {
    if ("startDate" in updates) setOrDeleteStringParam(params, "startDate", updates.startDate);
    if ("endDate" in updates) setOrDeleteStringParam(params, "endDate", updates.endDate);
  }

  if ("categoryId" in updates) setOrDeleteStringParam(params, "categoryId", updates.categoryId);
  if ("currency" in updates) setOrDeleteStringParam(params, "currency", updates.currency);
  if ("minAmount" in updates) setOrDeleteDecimalParam(params, "minAmount", updates.minAmount);
  if ("maxAmount" in updates) setOrDeleteDecimalParam(params, "maxAmount", updates.maxAmount);

  if ("statuses" in updates) {
    const formatted = updates.statuses != null ? formatStatusesParam(updates.statuses) : null;
    if (formatted != null) {
      params.set(STATUSES_URL_PARAM, formatted);
    } else {
      params.delete(STATUSES_URL_PARAM);
    }
  }
  if ("search" in updates) setOrDeleteStringParam(params, "search", updates.search);

  return params;
}

export function buildLedgerUrl(
  pathname: string,
  searchParams: SearchParamsStringLike | URLSearchParams
): string {
  const normalizedPathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const query = searchParams.toString();
  return query === "" ? normalizedPathname : `${normalizedPathname}?${query}`;
}
