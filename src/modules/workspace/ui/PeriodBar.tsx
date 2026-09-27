"use client";
import { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { textRoleClassName } from "@/components/typography";
import { Button } from "@/components/ui/button";
import { DateFilter } from "@/components/ui/date-filter";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TOOLBAR_ICON_BUTTON_CLASS } from "@/components/toolbar-control";
import { formatDateTimeForApi } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import {
  CALENDAR_RANGES,
  resolvePeriod,
  stepPeriod,
  type Period,
  type PeriodRange,
} from "@/modules/ledger/domain/period";
import { formatPeriodLabel } from "../period-label";
import { periodBarCopy } from "@/copy/controls";

interface PeriodBarProps {
  period: Period;
  /** Today in the ledger's zone, which every period is counted from. */
  today: string;
  onChange: (period: Period) => void;
  /** The ledger's zone, so the custom pickers name 今天 the ledger's way. */
  timeZone?: string;
  disabled?: boolean;
  className?: string;
}

const RANGE_CHOICES: readonly PeriodRange[] = [...CALENDAR_RANGES, "all", "custom"];

function rangeLabel(range: PeriodRange): string {
  return periodBarCopy[range];
}

/**
 * Which days a view reads: ‹ 2026年9月 › steps through calendar periods, and the
 * name in the middle opens the choice of 周, 月, 年, 全部 or two named days.
 * 账目 and 统计 carry the same bar, so a period means the same days on both.
 */
export function PeriodBar({
  period,
  today,
  onChange,
  timeZone,
  disabled = false,
  className,
}: PeriodBarProps) {
  const [open, setOpen] = useState(false);
  const steps = period.range !== "all" && period.range !== "custom";
  const canGoNext = steps && period.offset < 0;
  const label = formatPeriodLabel(period, today);

  return (
    <div className={cn("flex min-w-0 items-center", className)}>
      {steps ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn("shrink-0", TOOLBAR_ICON_BUTTON_CLASS)}
          disabled={disabled}
          onClick={() => onChange(stepPeriod(period, -1))}
          aria-label={periodBarCopy.previous}
          title={periodBarCopy.previous}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="h-8 min-w-0 gap-1 px-2 tabular-nums"
        aria-label={`${periodBarCopy.label}：${label}`}
        aria-haspopup="dialog"
      >
        <span className="truncate">{label}</span>
        <ChevronDown aria-hidden="true" className="opacity-60" />
      </Button>
      {steps ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn("shrink-0", TOOLBAR_ICON_BUTTON_CLASS)}
          disabled={disabled || !canGoNext}
          onClick={() => onChange(stepPeriod(period, 1))}
          aria-label={periodBarCopy.next}
          title={periodBarCopy.next}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      ) : null}
      {open ? (
        <PeriodDialog
          period={period}
          today={today}
          {...(timeZone != null ? { timeZone } : {})}
          onOpenChange={setOpen}
          onChange={(next) => {
            onChange(next);
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function PeriodDialog({
  period,
  today,
  timeZone,
  onOpenChange,
  onChange,
}: {
  period: Period;
  today: string;
  timeZone?: string;
  onOpenChange: (open: boolean) => void;
  onChange: (period: Period) => void;
}) {
  const current = resolvePeriod(period, today);
  const [custom, setCustom] = useState(period.range === "custom");
  const [from, setFrom] = useState(current?.from ?? today);
  const [to, setTo] = useState(current?.to ?? today);
  const customValid = from <= to;

  const choose = (range: PeriodRange) => {
    if (range === "custom") {
      setCustom(true);
      return;
    }
    onChange(range === "all" ? { range: "all" } : { range, offset: 0 });
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent variant="modal" className="sm:max-w-sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{periodBarCopy.choose}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-1 rounded-lg bg-surface2 p-1" role="group">
            {RANGE_CHOICES.map((range) => {
              const active = custom ? range === "custom" : period.range === range;
              return (
                <button
                  key={range}
                  type="button"
                  aria-pressed={active}
                  onClick={() => choose(range)}
                  className={cn(
                    textRoleClassName(
                      "bodyStrong",
                      "min-h-9 flex-1 whitespace-nowrap rounded-md px-1 transition-colors duration-[var(--motion-feedback)] sm:px-2"
                    ),
                    active
                      ? "bg-surface text-primary shadow-sm"
                      : "text-muted-foreground hover:text-text"
                  )}
                >
                  {rangeLabel(range)}
                </button>
              );
            })}
          </div>
          {custom ? (
            <div className="space-y-3">
              {/* Side by side the two dates get about 130px each on a phone,
                  which cuts the date short, so they stack there. */}
              <div className="grid gap-2 sm:flex sm:items-center">
                <DateFilter
                  value={from}
                  onChange={(date) => date != null && setFrom(formatDateTimeForApi(date))}
                  size="sm"
                  className="h-9 w-full sm:flex-1"
                  showClear={false}
                  showClearShortcut={false}
                  ariaLabel={periodBarCopy.from}
                  {...(timeZone != null ? { timeZone } : {})}
                />
                <span aria-hidden="true" className="hidden text-muted-foreground sm:inline">
                  –
                </span>
                <DateFilter
                  value={to}
                  onChange={(date) => date != null && setTo(formatDateTimeForApi(date))}
                  size="sm"
                  className="h-9 w-full sm:flex-1"
                  showClear={false}
                  showClearShortcut={false}
                  ariaLabel={periodBarCopy.to}
                  {...(timeZone != null ? { timeZone } : {})}
                />
              </div>
              <Button
                type="button"
                className="w-full"
                disabled={!customValid}
                onClick={() => onChange({ range: "custom", from, to })}
              >
                {periodBarCopy.apply}
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
