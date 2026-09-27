import { formatCivilDate } from "@/lib/date-utils";
import { DISPLAY_LOCALE } from "@/lib/constants";
import { resolvePeriod, type Period } from "@/modules/ledger/domain/period";
import { periodBarCopy } from "@/copy/controls";

/**
 * The name of the days a period covers, written the way the app writes days:
 * 2026年9月, 2026年, 9月22日 – 28日, or both ends of a named range. A year is
 * printed once when both ends share it, and not at all for a week in this year.
 */
export function formatPeriodLabel(period: Period, today: string): string {
  if (period.range === "all") return periodBarCopy.all;
  const range = resolvePeriod(period, today)!;
  const locale = DISPLAY_LOCALE;
  if (period.range === "month") {
    return formatCivilDate(range.from, locale, { year: "numeric", month: "long" });
  }
  if (period.range === "year") return formatCivilDate(range.from, locale, { year: "numeric" });

  const thisYear = today.slice(0, 4);
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
  const showYear = period.range === "custom" || !sameYear || range.from.slice(0, 4) !== thisYear;
  const sameMonth = sameYear && range.from.slice(0, 7) === range.to.slice(0, 7);
  const start = formatCivilDate(range.from, locale, {
    ...(showYear ? { year: "numeric" } : {}),
    month: "long",
    day: "numeric",
  });
  const end = formatCivilDate(
    range.to,
    locale,
    !sameYear
      ? { year: "numeric", month: "long", day: "numeric" }
      : sameMonth && period.range === "week"
        ? { day: "numeric" }
        : { month: "long", day: "numeric" }
  );
  return `${start} – ${end}`;
}
