"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { textRoleClassName } from "@/components/typography";
import { type DateRangeType } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

interface StatsPeriodBarProps {
  rangeType: DateRangeType;
  setRangeType: (type: DateRangeType) => void;
  periodOffset: number;
  setPeriodOffset: (offset: number) => void;
  label: string;
  readOnly?: boolean;
}

/**
 * Which stretch of time the tab is reading. It is one row rather than two
 * centred blocks: on a wide screen a centred column of controls leaves the
 * figures below it to start from nothing, and the eye has to travel the whole
 * width to find them.
 */
export function StatsPeriodBar({
  rangeType,
  setRangeType,
  periodOffset,
  setPeriodOffset,
  label,
  readOnly = false,
}: StatsPeriodBarProps) {
  const t = useTranslations("StatsTab");
  const canGoNext = periodOffset < 0;
  const rangeLabel = (type: DateRangeType) => {
    switch (type) {
      case "week":
        return t("week");
      case "month":
        return t("month");
      case "year":
        return t("year");
    }
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex w-full rounded-lg bg-surface2 p-1 sm:w-auto">
        {(["week", "month", "year"] as DateRangeType[]).map((type) => (
          <button
            type="button"
            key={type}
            onClick={() => {
              setRangeType(type);
            }}
            aria-pressed={rangeType === type}
            disabled={readOnly}
            className={cn(
              "flex-1 rounded-md px-4 py-1.5 text-sm font-medium transition-[color,background-color,border-color,opacity] duration-[var(--motion-feedback)]",
              rangeType === type
                ? "bg-surface text-primary shadow-sm"
                : "text-muted-foreground hover:text-text"
            )}
          >
            {rangeLabel(type)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-1 sm:justify-end">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setPeriodOffset(periodOffset - 1)}
          disabled={readOnly}
          aria-label={t("previousPeriod")}
        >
          <ChevronLeft aria-hidden="true" className="h-5 w-5" />
        </Button>
        <span className={textRoleClassName("sectionTitle", "min-w-32 text-center tabular-nums")}>
          {label}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setPeriodOffset(Math.min(0, periodOffset + 1))}
          disabled={readOnly || !canGoNext}
          aria-label={t("nextPeriod")}
        >
          <ChevronRight aria-hidden="true" className="h-5 w-5" />
        </Button>
        {periodOffset === 0 ? (
          <span className={textRoleClassName("meta", "ml-2")}>{t("throughToday")}</span>
        ) : null}
      </div>
    </div>
  );
}
