"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { getBookTotals, getEnhancedStats } from "@/lib/queries/ledger-query-client";
import {
  addPeriod,
  formatCivilDate,
  formatDateTimeForApi,
  getDateInTimezone,
  parseDateString,
  type DateRangeType,
} from "@/lib/date-utils";
import { StatsContentView } from "@/modules/stats/ui/StatsContentView";
import { useLocale, useTranslations } from "next-intl";
import type { Ledger } from "@/modules/ledger/contracts";
import { MAX_CHART_POINTS } from "@/modules/stats/lib/chart-points";
import { MAX_HEATMAP_DAYS } from "@/modules/stats/lib/heatmap-range";
import { QUERY } from "@/lib/constants";
import { queryKeys } from "@/lib/query-keys";
import { DEFAULT_STATS_RANGE_TYPE } from "@/modules/workspace/initial-query-state";
import { buildStatsQueryDescriptor } from "@/modules/workspace/ledger-tab-query-descriptors";
import { usePathname } from "@/i18n/routing";
import {
  readStatsSearchParams,
  setStatsSearchParams,
  type StatsRange,
  type StatsView,
} from "@/modules/workspace/ledger-url-params";
import { pushLedgerUrl } from "@/modules/workspace/ledger-url-navigation";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type { BookDto } from "@/modules/ledger/contracts";
import { formatCurrencyAmount } from "@/lib/format/currency";
import { cn } from "@/lib/utils";
import { BookScopeChip } from "./BookScopeChip";
import { toggleBookReveal, useBookRevealStore } from "@/lib/store/book-reveal";

const STATS_QUERY_DEBOUNCE_MS = 250;

interface StatsTabProps {
  /** The book the charts are narrowed to; undefined means 总账. */
  bookId?: string | undefined;
  /** The live books, for the per-book totals row. */
  books: readonly BookDto[];
  ledgerId?: string;
  ledger?: Ledger;
  onCategoryDrilldown?: (categoryId: string, startDate: string, endDate: string) => void;
  onDateDrilldown?: (date: string) => void;
  ledgerToday?: string;
  timeZone?: string;
}

export function StatsTab({
  bookId,
  books,
  ledgerId,
  ledger,
  onCategoryDrilldown,
  onDateDrilldown,
  ledgerToday,
  timeZone,
}: StatsTabProps) {
  const locale = useLocale();
  const tCommon = useTranslations("Common");
  const tBookScope = useTranslations("BookScope");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const bookRevealOpen = useBookRevealStore((state) => state.open);
  const statsUrlState = useMemo(() => readStatsSearchParams(searchParams), [searchParams]);
  const rangeType: DateRangeType = statsUrlState.range ?? DEFAULT_STATS_RANGE_TYPE;
  const periodOffset = statsUrlState.offset;
  const [todayKey, setTodayKey] = useState(
    () => ledgerToday ?? getDateInTimezone(timeZone) ?? formatDateTimeForApi(new Date())
  );
  useEffect(() => {
    const updateToday = () => {
      setTodayKey(getDateInTimezone(timeZone) ?? formatDateTimeForApi(new Date()));
    };
    updateToday();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") updateToday();
    };
    const interval = window.setInterval(updateToday, 60_000);
    window.addEventListener("focus", updateToday);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", updateToday);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [ledgerToday, timeZone]);
  const today = useMemo(() => parseDateString(todayKey), [todayKey]);
  const currentDate = useMemo(
    () => addPeriod(today, rangeType, periodOffset),
    [periodOffset, rangeType, today]
  );
  const chartView = statsUrlState.view;
  const updateStatsUrl = useCallback(
    (update: Partial<{ range: StatsRange; offset: number; view: StatsView }>) => {
      const params = setStatsSearchParams(searchParams, {
        range: update.range ?? statsUrlState.range,
        offset: update.offset ?? statsUrlState.offset,
        view: update.view ?? statsUrlState.view,
      });
      pushLedgerUrl(pathname, params, locale, "stats");
    },
    [locale, pathname, searchParams, statsUrlState]
  );

  const statsDescriptor = useMemo(
    () =>
      buildStatsQueryDescriptor({
        ledgerId: ledgerId ?? "",
        ...(bookId == null ? {} : { bookId }),
        currentDate,
        mainCurrency: ledger?.settings.mainCurrency ?? "CNY",
        rangeType,
        currentPeriod: periodOffset === 0,
      }),
    [bookId, currentDate, ledger?.settings.mainCurrency, ledgerId, periodOffset, rangeType]
  );
  const queryDescriptor = useDebouncedValue(statsDescriptor, STATS_QUERY_DEBOUNCE_MS);
  // The debounce is for period changes, where the range is still being dragged
  // around. A book switch is a deliberate navigation, so it must not wait behind
  // the previous book's request: the new scope's descriptor is used at once, and
  // its key is what stops the old figures being shown meanwhile.
  const scopeDescriptor =
    queryDescriptor.input.bookId === statsDescriptor.input.bookId
      ? queryDescriptor
      : statsDescriptor;
  // One grouped read for the whole totals row: every live book plus 总账, in the
  // same settled range the charts use. It replaces one stats call per book per
  // period change; the numbers are the same sums the single-book queries
  // produced. It follows the debounced range, so the row and the charts move
  // together.
  const bookTotalsQuery = useQuery({
    queryKey: queryKeys.bookTotals(ledgerId ?? "", {
      startDate: queryDescriptor.state.startDateStr,
      endDate: queryDescriptor.state.endDateStr,
    }),
    queryFn: () =>
      getBookTotals({
        ledgerId: ledgerId ?? "",
        queryRange: {
          from: queryDescriptor.state.startDateStr,
          to: queryDescriptor.state.endDateStr,
        },
      }),
    enabled: !!ledgerId,
    staleTime: QUERY.DEFAULT_STALE_TIME_MS,
  });
  const statsQuery = useQuery({
    queryKey: scopeDescriptor.queryKey,
    queryFn: () => getEnhancedStats(scopeDescriptor.input),
    enabled: ledgerId !== undefined && ledgerId !== "",
    staleTime: QUERY.DEFAULT_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });
  // The last successful figures are kept while a refetch runs, but only for the
  // book they belong to: switching books must not show the previous book's
  // numbers under the new book's name. The descriptor travels with them so the
  // period label stays the one the numbers were computed for.
  const [lastResolved, setLastResolved] = useState<{
    stats: NonNullable<typeof statsQuery.data>;
    descriptor: typeof scopeDescriptor.state;
    scope: string | null;
  } | null>(null);
  useEffect(() => {
    if (statsQuery.data === undefined) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setLastResolved({
        stats: statsQuery.data!,
        descriptor: scopeDescriptor.state,
        scope: bookId ?? null,
      });
    });
    return () => {
      active = false;
    };
  }, [bookId, scopeDescriptor.state, statsQuery.data]);
  const lastResolvedForScope = lastResolved?.scope === (bookId ?? null) ? lastResolved : null;
  const stats = statsQuery.data ?? lastResolvedForScope?.stats;
  const contentDescriptor =
    statsQuery.data === undefined && lastResolvedForScope != null
      ? lastResolvedForScope.descriptor
      : scopeDescriptor.state;
  const { isError, refetch } = statsQuery;
  const {
    startDate: contentStartDate,
    endDate: contentEndDate,
    startDateStr: contentStartDateStr,
    endDateStr: contentEndDateStr,
    rangeType: contentRangeType,
  } = contentDescriptor;
  const hasOversizedResult =
    stats != null &&
    ((contentRangeType !== "year" && stats.chart.length > MAX_CHART_POINTS) ||
      stats.heatmap.days.length > MAX_HEATMAP_DAYS);

  const contentLabel = useMemo(() => {
    switch (contentRangeType) {
      case "week":
        return `${formatCivilDate(contentStartDateStr, locale, { month: "numeric", day: "numeric" })} - ${formatCivilDate(contentEndDateStr, locale, { month: "numeric", day: "numeric" })}`;
      case "month":
        return formatCivilDate(contentStartDateStr, locale, { year: "numeric", month: "long" });
      case "year":
        return formatCivilDate(contentStartDateStr, locale, { year: "numeric" });
      default:
        return "";
    }
  }, [contentEndDateStr, contentRangeType, contentStartDateStr, locale]);

  const scopeBookName =
    bookId == null ? null : (books.find((book) => book.id === bookId)?.name ?? null);
  const totalsCurrency = bookTotalsQuery.data?.currency ?? ledger?.settings.mainCurrency ?? "CNY";
  const bookTotals = bookTotalsQuery.data;
  // 总账 leads the row, matching the strip's own order. A book with no entries
  // in the period is absent from the grouped read and shows as zero; both the
  // loaded value and the placeholder are per-scope, so a stale figure cannot
  // pass as the new book's.
  const totalRows = [
    { key: "all", label: tCommon("allBooks"), total: bookTotals?.total },
    ...books.map((book) => ({
      key: book.id,
      label: book.name,
      total:
        bookTotals == null
          ? undefined
          : (bookTotals.books.find((row) => row.bookId === book.id)?.total ?? "0"),
    })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 border-b pb-3">
        <div className="flex flex-1 gap-3 overflow-x-auto text-sm" aria-live="polite">
          {totalRows.map(({ key, label, total }) => (
            <div key={key} className="min-w-16 shrink-0">
              <div className="truncate text-muted-foreground">{label}</div>
              <div className="truncate font-semibold">
                {total != null
                  ? formatCurrencyAmount(total, totalsCurrency, locale)
                  : bookTotalsQuery.isError
                    ? "—"
                    : "..."}
              </div>
            </div>
          ))}
        </div>
        {/* The scope the charts are showing, with the way back into the strip:
            the chip when a book is selected, and a plain trigger in 总账, which
            has no name to show. Both are how a keyboard reaches the switcher,
            which is otherwise only a pull gesture. */}
        <div className="shrink-0">
          {scopeBookName != null ? (
            <BookScopeChip name={scopeBookName} />
          ) : (
            <button
              type="button"
              data-testid="book-scope-trigger"
              data-pull-reveal-ignore
              aria-expanded={bookRevealOpen}
              aria-label={tBookScope("current", { book: tCommon("allBooks") })}
              onClick={(event) => toggleBookReveal(event.currentTarget)}
              className="flex shrink-0 items-center gap-1 rounded-sm border border-border bg-surface px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-text"
            >
              {tBookScope("label")}
              <ChevronDown
                aria-hidden="true"
                className={cn("h-4 w-4 transition-transform", bookRevealOpen && "rotate-180")}
              />
            </button>
          )}
        </div>
      </div>
      <StatsContentView
        rangeType={rangeType}
        contentRangeType={contentRangeType}
        onRangeTypeChange={(type) => {
          updateStatsUrl({ range: type, offset: 0 });
        }}
        periodOffset={periodOffset}
        onPeriodOffsetChange={(offset) => updateStatsUrl({ offset })}
        label={contentLabel}
        startDate={contentStartDate}
        endDate={contentEndDate}
        startDateStr={contentStartDateStr}
        endDateStr={contentEndDateStr}
        stats={hasOversizedResult ? undefined : stats}
        isLoading={statsQuery.isFetching}
        isError={isError || hasOversizedResult}
        onRetry={() => void refetch()}
        chartView={chartView}
        onChartViewChange={(view) => updateStatsUrl({ view })}
        fallbackCurrency={ledger?.settings.mainCurrency ?? "CNY"}
        {...(onCategoryDrilldown !== undefined ? { onCategoryDrilldown } : {})}
        {...(onDateDrilldown !== undefined ? { onDateDrilldown } : {})}
      />
    </div>
  );
}
