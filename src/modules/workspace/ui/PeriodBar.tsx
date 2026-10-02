"use client";
import { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TOOLBAR_ICON_BUTTON_CLASS } from "@/components/toolbar-control";
import { cn } from "@/lib/utils";
import { canStepPeriod, stepPeriod, type Period } from "@/modules/ledger/domain/period";
import { formatPeriodLabel } from "../period-label";
import { PeriodPicker } from "./PeriodPicker";
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

/**
 * Which days a view reads: ‹ 2026年9月 › steps through calendar periods, and the
 * name in the middle opens the period picker. 账目, 明细 and 统计 carry the same
 * bar from md up, so a period means the same days on all three; a phone steps
 * from the top bar and picks from the controls it drops down.
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
  const canGoNext = canStepPeriod(period, 1);
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
          data-track="period.prev"
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
        data-track="period.open"
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
          data-track="period.next"
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
  return (
    <Dialog name="period.picker" open onOpenChange={onOpenChange}>
      <DialogContent variant="modal" className="sm:max-w-sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{periodBarCopy.choose}</DialogTitle>
        </DialogHeader>
        <PeriodPicker
          period={period}
          today={today}
          onChange={onChange}
          {...(timeZone != null ? { timeZone } : {})}
        />
      </DialogContent>
    </Dialog>
  );
}
