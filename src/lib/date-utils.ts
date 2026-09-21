import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  addWeeks,
  addMonths,
  addYears,
  startOfDay,
  endOfDay,
  parseISO,
} from "date-fns";

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function getDateTimeFormatter(
  locale: string,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  const key = `${locale}:${JSON.stringify(options)}`;
  let formatter = dateTimeFormatters.get(key);
  if (formatter == null) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateTimeFormatters.set(key, formatter);
  }
  return formatter;
}

export type DateRangeType = "week" | "month" | "year";

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export function getStartOfWeek(date: Date): Date {
  return startOfWeek(date, { weekStartsOn: 1 });
}

export function getEndOfWeek(date: Date): Date {
  return endOfWeek(date, { weekStartsOn: 1 });
}

export function getStartOfMonth(date: Date): Date {
  return startOfMonth(date);
}

export function getEndOfMonth(date: Date): Date {
  return endOfMonth(date);
}

export function getStartOfYear(date: Date): Date {
  return startOfYear(date);
}

export function getEndOfYear(date: Date): Date {
  return endOfYear(date);
}

export function getDateRange(date: Date, type: DateRangeType): DateRange {
  let start: Date;
  let end: Date;

  switch (type) {
    case "week":
      start = getStartOfWeek(date);
      end = getEndOfWeek(date);
      break;
    case "month":
      start = getStartOfMonth(date);
      end = getEndOfMonth(date);
      break;
    case "year":
      start = getStartOfYear(date);
      end = getEndOfYear(date);
      break;
  }

  return { startDate: start, endDate: end };
}

export function addPeriod(date: Date, type: DateRangeType, amount: number): Date {
  switch (type) {
    case "week":
      return addWeeks(date, amount);
    case "month":
      return addMonths(date, amount);
    case "year":
      return addYears(date, amount);
  }
}

/**
 * Format date to yyyy-MM-dd string using LOCAL time (not UTC).
 *
 * This completely avoids timezone issues by only transmitting the date portion.
 * The backend is responsible for interpreting startDate as "start of day"
 * and endDate as "end of day" when constructing queries.
 *
 * Why not include time? Because:
 * 1. User selects dates in their local timezone
 * 2. Server may run in a different timezone (e.g., UTC in Docker)
 * 3. Using just the date makes the intention unambiguous
 */
export function formatDateTimeForApi(date: Date): string;
export function formatDateTimeForApi(date: Date | undefined): string | undefined;
export function formatDateTimeForApi(date: Date | undefined): string | undefined {
  if (date == null) return undefined;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Format a date-only value without interpreting it as an instant in time. */
export function formatCivilDate(
  dateString: string,
  locale: string,
  options: Intl.DateTimeFormatOptions
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (match == null) throw new RangeError(`Invalid civil date: ${dateString}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid civil date: ${dateString}`);
  }

  return getDateTimeFormatter(locale, { ...options, timeZone: "UTC" }).format(date);
}

/**
 * Parse a date string as the START of day (00:00:00.000).
 * Used by backend to construct query conditions for startDate parameters.
 *
 * Uses date-fns for reliable parsing and day boundary calculation.
 */
export function parseDateRangeStart(dateStr: string | null | undefined): Date | null {
  if (dateStr == null || dateStr === "") return null;

  // parseISO handles both "yyyy-MM-dd" and full ISO strings
  const parsed = parseISO(dateStr);
  if (isNaN(parsed.getTime())) return null;

  return startOfDay(parsed);
}

/**
 * Parse a date string as the END of day (23:59:59.999).
 * Used by backend to construct query conditions for endDate parameters.
 *
 * Uses date-fns for reliable parsing and day boundary calculation.
 */
export function parseDateRangeEnd(dateStr: string | null | undefined): Date | null {
  if (dateStr == null || dateStr === "") return null;

  // parseISO handles both "yyyy-MM-dd" and full ISO strings
  const parsed = parseISO(dateStr);
  if (isNaN(parsed.getTime())) return null;

  return endOfDay(parsed);
}

/**
 * Parse a "YYYY-MM-DD" string as a local-time Date (midnight local).
 *
 * IMPORTANT: Do NOT use `new Date("YYYY-MM-DD")` — JS spec treats date-only
 * strings as UTC midnight, which shifts the date in non-UTC timezones.
 * This function always creates the date in the runtime's local timezone.
 */
export function parseDateString(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  if (
    year == null ||
    month == null ||
    day == null ||
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day)
  ) {
    return new Date(Number.NaN);
  }
  return new Date(year, month - 1, day);
}

/**
 * Validate a "YYYY-MM-DD" string by round-tripping through the local date parser.
 *
 * This rejects impossible dates like 2026-02-30 while preserving local-time semantics.
 */
export function isValidDateString(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;

  const parsed = parseDateString(dateStr);
  if (isNaN(parsed.getTime())) return false;

  return formatDateTimeForApi(parsed) === dateStr;
}

/**
 * Get today's date (YYYY-MM-DD) in a specific timezone.
 * Uses Intl API — works regardless of server's TZ setting.
 */
export function getDateInTimezone(timezone?: string): string | undefined {
  if (timezone == null || timezone === "") return undefined;
  try {
    return getDateTimeFormatter("sv-SE", { timeZone: timezone }).format(new Date());
  } catch {
    return undefined; // invalid timezone string
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    getDateTimeFormatter("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

/**
 * The app's one label for a "YYYY-MM-DD" day: Today / Yesterday when the day is
 * one of those in the viewer's timezone, otherwise the full written date —
 * "2026年9月10日 星期四", "Thursday, September 10, 2026". The today/yesterday
 * words come from the caller so each feature reads them from its own catalog.
 * Malformed input is returned unchanged.
 */
export function formatRelativeDateLabel(
  dateString: string,
  locale: string,
  labels: { today: string; yesterday: string },
  timeZone?: string
): string {
  const date = parseDateString(dateString);
  if (isNaN(date.getTime())) return dateString;

  const zonedToday = getDateInTimezone(timeZone);
  const today = zonedToday != null ? parseDateString(zonedToday) : new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const key = localDateKey(date);
  if (key === localDateKey(today)) return labels.today;
  if (key === localDateKey(yesterday)) return labels.yesterday;
  return formatFullDate(date, locale);
}

/**
 * {@link formatRelativeDateLabel} for a timestamp rather than a civil date: the
 * instant is first resolved to the day it falls on in `timeZone`.
 */
export function formatInstantDateLabel(
  instant: string | Date,
  locale: string,
  labels: { today: string; yesterday: string },
  timeZone?: string
): string {
  const date = typeof instant === "string" ? parseISO(instant) : instant;
  if (isNaN(date.getTime())) return typeof instant === "string" ? instant : "";
  return formatRelativeDateLabel(formatDateKeyInTimeZone(date, timeZone), locale, labels, timeZone);
}

/**
 * A day written out in full, weekday and year included. Chinese trails the
 * weekday, English leads it — each language's own order for a written date.
 */
export function formatFullDate(date: Date, locale: string): string {
  const day = getDateTimeFormatter(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
  const weekday = getDateTimeFormatter(locale, { weekday: "long" }).format(date);
  return locale.startsWith("zh") ? `${day} ${weekday}` : `${weekday}, ${day}`;
}

/** The calendar day an instant falls on, as "YYYY-MM-DD", in `timeZone`. */
export function formatDateKeyInTimeZone(date: Date, timeZone?: string): string {
  try {
    return getDateTimeFormatter(
      "sv-SE",
      timeZone == null || timeZone === "" ? {} : { timeZone }
    ).format(date);
  } catch {
    // An unusable timezone falls back to the runtime's own day.
    return formatDateTimeForApi(date);
  }
}

function localDateKey(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}
