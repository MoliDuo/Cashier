"use client";
import { useTranslations } from "next-intl";
import { textRoleClassName } from "@/components/typography";
import { formatCivilDate } from "@/lib/date-utils";
import { formatCurrencyAmount } from "@/lib/format/currency";
import { AmountText } from "@/modules/currency/ui/amount-text";
import type { StatsInsights } from "@/modules/stats/lib/derived-insights";
import { StatsPanel } from "./StatsPanel";
import { DISPLAY_LOCALE } from "@/lib/constants";

interface StatsHighlightsProps {
  insights: StatsInsights;
  currencySymbol: string;
  periodLabel: string;
  onDateDrilldown?: (date: string) => void;
}

/**
 * The three sentences the heatmap and the ranking each half-answer: which day
 * cost the most, how long the run of recorded days is, and which category moved.
 *
 * The biggest day earns its place because a single outlying day is what drags
 * the headline comparison to figures like -97.9%; naming it turns a number that
 * looks broken into one the reader can go and check.
 */
export function StatsHighlights({
  insights,
  currencySymbol,
  periodLabel,
  onDateDrilldown,
}: StatsHighlightsProps) {
  const t = useTranslations("StatsTab");
  const locale = DISPLAY_LOCALE;
  const { busiestDay, longestStreak, topMover } = insights;

  if (busiestDay == null && longestStreak === 0 && topMover == null) return null;

  return (
    <StatsPanel title={t("highlights")}>
      <dl className="space-y-3">
        {busiestDay != null ? (
          <div className="flex items-baseline justify-between gap-3">
            <dt className={textRoleClassName("bodyMuted")}>{t("busiestDay")}</dt>
            <dd className="flex min-w-0 items-baseline gap-2">
              {onDateDrilldown == null ? (
                <span className={textRoleClassName("meta")}>
                  {formatCivilDate(busiestDay.date, locale, { month: "numeric", day: "numeric" })}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onDateDrilldown(busiestDay.date)}
                  className={textRoleClassName(
                    "meta",
                    "rounded underline underline-offset-2 hover:text-text"
                  )}
                >
                  {formatCivilDate(busiestDay.date, locale, { month: "numeric", day: "numeric" })}
                </button>
              )}
              <AmountText variant="summary">
                {formatCurrencyAmount(busiestDay.total, currencySymbol, locale)}
              </AmountText>
            </dd>
          </div>
        ) : null}

        {longestStreak > 0 ? (
          <div className="flex items-baseline justify-between gap-3">
            <dt className={textRoleClassName("bodyMuted")}>{t("recordingStreak")}</dt>
            <dd className={textRoleClassName("bodyStrong", "tabular-nums")}>
              {t("streakDays", { days: longestStreak })}
            </dd>
          </div>
        ) : null}
      </dl>

      {topMover != null ? (
        <p className={textRoleClassName("bodyMuted", "border-t border-border pt-3")}>
          {/* Both keys are spelled out so the catalogue check can find them. */}
          {topMover.direction === "up"
            ? t("topMoverUp", moverValues(topMover, periodLabel, currencySymbol, locale))
            : t("topMoverDown", moverValues(topMover, periodLabel, currencySymbol, locale))}
        </p>
      ) : null}
    </StatsPanel>
  );
}

function moverValues(
  mover: NonNullable<StatsInsights["topMover"]>,
  periodLabel: string,
  currencySymbol: string,
  locale: string
) {
  return {
    category: mover.name,
    period: periodLabel,
    // Whole units: the sentence is about the size of the change, not its cents.
    amount: formatCurrencyAmount(mover.amountDelta, currencySymbol, locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }),
  };
}
