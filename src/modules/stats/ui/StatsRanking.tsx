"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CategoryIcon } from "@/components/CategoryIcon";
import { EmptyState } from "@/components/EmptyState";
import { textRoleClassName } from "@/components/typography";
import { Button } from "@/components/ui/button";
import { formatCurrencyAmount } from "@/lib/format/currency";
import { compare } from "@/lib/money/decimal";
import { cn } from "@/lib/utils";
import { AmountText } from "@/modules/currency/ui/amount-text";
import { StatsPanel } from "./StatsPanel";

/** Past this many, the tail is folded away: a ranking is read from the top. */
const COLLAPSED_LENGTH = 6;

interface CategoryStat {
  id: string | null;
  name: string;
  icon: string | null;
  totalConverted: string;
  /** Share of the period's spending; zero for a category that nets out at or below nothing. */
  percent: number;
  count: number;
}

interface StatsRankingProps {
  data: CategoryStat[];
  isLoading?: boolean;
  currencySymbol?: string;
  onCategoryClick?: (categoryId: string) => void;
}

export function StatsRanking({
  data,
  isLoading,
  currencySymbol = "CNY",
  onCategoryClick,
}: StatsRankingProps) {
  const t = useTranslations("StatsTab");
  const tCalendar = useTranslations("Calendar");
  const locale = useLocale();
  const [expanded, setExpanded] = useState(false);

  if (isLoading) {
    return (
      <StatsPanel title={t("expenseRanking")}>
        <div className="space-y-5" role="status" aria-busy="true">
          {[1, 2, 3, 4, 5].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-surface2/50" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-24 animate-pulse rounded bg-surface2/50" />
                <div className="h-1.5 w-full animate-pulse rounded-full bg-surface2/50" />
              </div>
              <div className="h-4 w-20 animate-pulse rounded bg-surface2/50" />
            </div>
          ))}
        </div>
      </StatsPanel>
    );
  }

  if (data.length === 0) {
    return (
      <StatsPanel title={t("expenseRanking")}>
        <EmptyState title={t("noStats")} description={t("noStatsDesc")} />
      </StatsPanel>
    );
  }

  const visible = expanded ? data : data.slice(0, COLLAPSED_LENGTH);
  const hidden = data.length - visible.length;

  return (
    <StatsPanel title={t("expenseRanking")}>
      <div className="space-y-4">
        {visible.map((category) => {
          const displayName = category.id === null ? t("uncategorized") : category.name;
          // A refunded category has no share of what was spent. It keeps its
          // amount and its place in the order; only the bar has nothing to say.
          const hasShare = compare(category.totalConverted, "0") > 0;
          const amount = formatCurrencyAmount(category.totalConverted, currencySymbol, locale);
          const share = `${category.percent.toFixed(0)}%`;

          return (
            <button
              type="button"
              key={category.id ?? "__uncategorized__"}
              disabled={onCategoryClick == null}
              aria-label={`${displayName}, ${amount}, ${hasShare ? share : t("noShare")}`}
              className={cn(
                "group grid w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 text-left",
                onCategoryClick != null &&
                  "-mx-2 cursor-pointer rounded-lg px-2 py-1 transition-colors hover:bg-surface2/50"
              )}
              onClick={() => onCategoryClick?.(category.id ?? "__uncategorized__")}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface2 transition-colors group-hover:bg-primary/10">
                <CategoryIcon
                  iconName={category.icon}
                  className="h-5 w-5 text-text/80 transition-colors group-hover:text-primary"
                />
              </span>

              <span className="min-w-0 space-y-1.5">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={textRoleClassName("bodyStrong", "truncate")}>{displayName}</span>
                  <span className={textRoleClassName("meta", "shrink-0 tabular-nums")}>
                    {tCalendar("count", { count: category.count })}
                  </span>
                </span>
                <span className="block h-1.5 overflow-hidden rounded-full bg-surface2">
                  <span
                    className="block h-full origin-left rounded-full bg-primary transition-transform duration-[var(--motion-expand)] ease-[var(--motion-enter)]"
                    style={{
                      transform: `scaleX(${hasShare ? Math.max(0, Math.min(100, category.percent)) / 100 : 0})`,
                    }}
                  />
                </span>
              </span>

              <span className="shrink-0 text-right">
                <AmountText variant="item" className="block">
                  {amount}
                </AmountText>
                <span className={textRoleClassName("meta", "block tabular-nums")}>
                  {hasShare ? share : "—"}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {data.length > COLLAPSED_LENGTH ? (
        <Button variant="ghost" className="w-full" onClick={() => setExpanded(!expanded)}>
          {expanded ? t("showFewerCategories") : t("showAllCategories", { count: hidden })}
        </Button>
      ) : null}
    </StatsPanel>
  );
}
