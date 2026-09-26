"use client";
import { textRoleClassName } from "@/components/typography";
import { formatCurrencyAmount } from "@/lib/format/currency";
import { AmountText } from "@/modules/currency/ui/amount-text";
import type { StatsInsights } from "@/modules/stats/lib/derived-insights";
import { DISPLAY_LOCALE } from "@/lib/constants";
import { statsTabCopy } from "@/copy/stats";

interface StatsMetricStripProps {
  insights: StatsInsights;
  dailyAverage: string;
  currencySymbol: string;
}

/**
 * The four figures that put the headline total in proportion. They were all
 * being computed already and thrown away, and without them the total answers
 * "how much" but never "off how many days" or "how big a purchase".
 */
export function StatsMetricStrip({
  insights,
  dailyAverage,
  currencySymbol,
}: StatsMetricStripProps) {
  const locale = DISPLAY_LOCALE;
  const money = (amount: string) => formatCurrencyAmount(amount, currencySymbol, locale);

  const metrics: { label: string; value: React.ReactNode }[] = [
    {
      label: statsTabCopy.averageDaily,
      value: <AmountText variant="summary">{money(dailyAverage)}</AmountText>,
    },
    {
      label: statsTabCopy.entries,
      value: (
        <span className={textRoleClassName("bodyStrong", "tabular-nums")}>
          {insights.entryCount}
        </span>
      ),
    },
    {
      label: statsTabCopy.averageEntry,
      value:
        insights.averageEntry == null ? (
          <span className={textRoleClassName("bodyStrong")}>—</span>
        ) : (
          <AmountText variant="summary">{money(insights.averageEntry)}</AmountText>
        ),
    },
    {
      label: statsTabCopy.recordedDays,
      value: (
        <span className={textRoleClassName("bodyStrong", "tabular-nums")}>
          {statsTabCopy.recordedDaysValue({
            active: insights.activeDays,
            total: insights.periodDays,
          })}
        </span>
      ),
    },
  ];

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
      {metrics.map((metric) => (
        <div key={metric.label} className="min-w-0 space-y-0.5">
          <dt className={textRoleClassName("meta")}>{metric.label}</dt>
          <dd className="min-w-0 truncate">{metric.value}</dd>
        </div>
      ))}
    </dl>
  );
}
