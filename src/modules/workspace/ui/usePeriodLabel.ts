"use client";
import { formatCivilDate } from "@/lib/date-utils";
import { periodToDateRange, type PeriodParams } from "@/lib/period-utils";
import { resolveActivePreset } from "@/modules/ledger/entry-filter-presets";
import { DISPLAY_LOCALE } from "@/lib/constants";
import { dateRangeFilterCopy } from "@/copy/controls";

/**
 * Names the span a ledger toolbar is showing, so the row reads as "本月 ·
 * ¥12,345" instead of a total with no date attached.
 *
 * A preset keeps its name; any other range prints its two days, so a ledger
 * opened on a range the panel cannot express still says what it covers.
 */
export function usePeriodLabel(periodParams: PeriodParams, timeZone?: string): string | null {
  const locale = DISPLAY_LOCALE;
  const preset = resolveActivePreset(periodParams);

  if (preset === "thisMonth") return dateRangeFilterCopy.thisMonth;
  if (preset === "lastMonth") return dateRangeFilterCopy.lastMonth;
  if (preset === "all") return dateRangeFilterCopy.all;

  const range = periodToDateRange(periodParams, timeZone);
  if (range.startDate == null || range.endDate == null) return dateRangeFilterCopy.all;

  // The year is printed once when both ends share it, the way the rest of the
  // app writes a day rather than repeating the year on both sides.
  const sameYear = range.startDate.slice(0, 4) === range.endDate.slice(0, 4);
  const start = formatCivilDate(range.startDate, locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const end = formatCivilDate(
    range.endDate,
    locale,
    sameYear
      ? { month: "long", day: "numeric" }
      : { year: "numeric", month: "long", day: "numeric" }
  );
  return `${start} - ${end}`;
}
