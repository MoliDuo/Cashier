/**
 * Period-based filter utilities for URL-driven state management.
 *
 * Used by both server (page.tsx) and client (LedgerEntriesTab) to ensure
 * consistent date range calculation and query key matching.
 */

import {
  formatDateTimeForApi,
  getDateInTimezone,
  isValidDateString,
  parseDateString,
} from "./date-utils";

export type PeriodPreset =
  "all" | "thisMonth" | "lastMonth" | "week" | "month" | "3months" | "6months" | "year" | "custom";

export interface PeriodParams {
  period: PeriodPreset;
  startDate?: string; // YYYY-MM-DD format (only for 'custom')
  endDate?: string; // YYYY-MM-DD format (only for 'custom')
}

export interface DateRange {
  startDate: string | null; // ISO datetime string for API
  endDate: string | null; // ISO datetime string for API
}

function subtractCalendarMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const originalDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() - months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(originalDay, lastDay));
  return result;
}

function subtractCalendarYears(date: Date, years: number): Date {
  const result = new Date(date);
  const originalDay = result.getDate();
  const targetMonth = result.getMonth();
  result.setDate(1);
  result.setFullYear(result.getFullYear() - years);
  result.setMonth(targetMonth);
  const lastDay = new Date(result.getFullYear(), targetMonth + 1, 0).getDate();
  result.setDate(Math.min(originalDay, lastDay));
  return result;
}

/**
 * Convert period preset to actual date range.
 * Works on both server and client.
 */
export function periodToDateRange(params: PeriodParams, timeZone?: string): DateRange {
  const { period, startDate, endDate } = params;

  if (period === "all") {
    return { startDate: null, endDate: null };
  }

  if (period === "custom" && startDate != null && endDate != null) {
    const start = parseDateString(startDate);
    const end = parseDateString(endDate);
    return {
      startDate: formatDateTimeForApi(start) ?? null,
      endDate: formatDateTimeForApi(end) ?? null,
    };
  }

  const zonedDate = getDateInTimezone(timeZone);
  const now = zonedDate != null ? parseDateString(zonedDate) : new Date();

  if (period === "thisMonth") {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return {
      startDate: formatDateTimeForApi(monthStart) ?? null,
      endDate: formatDateTimeForApi(monthEnd) ?? null,
    };
  }

  if (period === "lastMonth") {
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return {
      startDate: formatDateTimeForApi(lastMonthStart) ?? null,
      endDate: formatDateTimeForApi(lastMonthEnd) ?? null,
    };
  }

  if (period === "week") {
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    weekAgo.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    return {
      startDate: formatDateTimeForApi(weekAgo) ?? null,
      endDate: formatDateTimeForApi(endOfToday) ?? null,
    };
  }

  if (period === "month") {
    const monthAgo = subtractCalendarMonths(now, 1);
    monthAgo.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    return {
      startDate: formatDateTimeForApi(monthAgo) ?? null,
      endDate: formatDateTimeForApi(endOfToday) ?? null,
    };
  }

  if (period === "3months") {
    const threeMonthsAgo = subtractCalendarMonths(now, 3);
    threeMonthsAgo.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    return {
      startDate: formatDateTimeForApi(threeMonthsAgo) ?? null,
      endDate: formatDateTimeForApi(endOfToday) ?? null,
    };
  }

  if (period === "6months") {
    const sixMonthsAgo = subtractCalendarMonths(now, 6);
    sixMonthsAgo.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    return {
      startDate: formatDateTimeForApi(sixMonthsAgo) ?? null,
      endDate: formatDateTimeForApi(endOfToday) ?? null,
    };
  }

  if (period === "year") {
    const yearAgo = subtractCalendarYears(now, 1);
    yearAgo.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    return {
      startDate: formatDateTimeForApi(yearAgo) ?? null,
      endDate: formatDateTimeForApi(endOfToday) ?? null,
    };
  }

  // Default to thisMonth if unknown period
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return {
    startDate: formatDateTimeForApi(monthStart) ?? null,
    endDate: formatDateTimeForApi(monthEnd) ?? null,
  };
}

/**
 * Parse period parameters from URL search params.
 * Works with both server searchParams object and URLSearchParams.
 */
export function parsePeriodFromSearchParams(
  searchParams:
    | { [key: string]: string | string[] | undefined }
    | URLSearchParams
    | { get: (key: string) => string | null }
): PeriodParams {
  let period: string | null = null;
  let startDate: string | null = null;
  let endDate: string | null = null;

  if (
    searchParams instanceof URLSearchParams ||
    typeof (searchParams as { get?: unknown }).get === "function"
  ) {
    // URLSearchParams or similar interface
    const sp = searchParams as { get: (key: string) => string | null };
    period = sp.get("period");
    startDate = sp.get("startDate");
    endDate = sp.get("endDate");
  } else {
    // Plain object from Next.js server searchParams
    const sp = searchParams as { [key: string]: string | string[] | undefined };
    const readFirst = (value: string | string[] | undefined): string | null => {
      if (Array.isArray(value)) {
        return value[0] ?? null;
      }
      return value ?? null;
    };

    period = readFirst(sp.period);
    startDate = readFirst(sp.startDate);
    endDate = readFirst(sp.endDate);
  }

  // Validate period value
  const validPeriods: PeriodPreset[] = [
    "all",
    "thisMonth",
    "lastMonth",
    "week",
    "month",
    "3months",
    "6months",
    "year",
    "custom",
  ];
  let validatedPeriod: PeriodPreset = validPeriods.includes(period as PeriodPreset)
    ? (period as PeriodPreset)
    : "thisMonth"; // Default to thisMonth

  const validCustomRange =
    validatedPeriod === "custom" &&
    startDate != null &&
    endDate != null &&
    isValidDateString(startDate) &&
    isValidDateString(endDate) &&
    startDate <= endDate;
  if (validatedPeriod === "custom" && !validCustomRange) validatedPeriod = "thisMonth";

  const parsedParams: PeriodParams = {
    period: validatedPeriod,
  };

  if (validCustomRange) {
    parsedParams.startDate = startDate!;
    parsedParams.endDate = endDate!;
  }

  return parsedParams;
}

/**
 * Convert Date objects to PeriodParams for custom date ranges.
 */
export function datesToPeriodParams(startDate?: Date, endDate?: Date): PeriodParams {
  if (!startDate || !endDate) {
    return { period: "thisMonth" };
  }

  const formatDate = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  return {
    period: "custom",
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
  };
}
