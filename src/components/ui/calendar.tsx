"use client";
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  addDays,
  addYears,
  subMonths,
  format,
  isToday,
} from "date-fns";
import { calendarCopy } from "@/copy/controls";

interface CalendarProps {
  value?: Date | null;
  onChange: (date: Date | null) => void;
  /** Whether to show shortcut options */
  showShortcuts?: boolean;
  /**
   * Whether the shortcuts include 清除. Fields whose value cannot be empty (a
   * document date, a batch target date) hide it, so no visible control is a
   * no-op.
   */
  showClearShortcut?: boolean;
  /** 最小可选日期 */
  minDate?: Date;
  /** 最大可选日期 */
  maxDate?: Date;
  className?: string;
  onEscape?: () => void;
}

export function Calendar({
  value,
  onChange,
  showShortcuts = true,
  showClearShortcut = true,
  minDate,
  maxDate,
  className,
  onEscape,
}: CalendarProps) {
  return (
    <CalendarView
      key={value?.getTime() ?? "empty"}
      value={value}
      onChange={onChange}
      showShortcuts={showShortcuts}
      showClearShortcut={showClearShortcut}
      minDate={minDate}
      maxDate={maxDate}
      className={className}
      onEscape={onEscape}
    />
  );
}

function CalendarView({
  value,
  onChange,
  showShortcuts,
  showClearShortcut,
  minDate,
  maxDate,
  className,
  onEscape,
}: {
  value: Date | null | undefined;
  onChange: (date: Date | null) => void;
  showShortcuts: boolean;
  showClearShortcut: boolean;
  minDate: Date | undefined;
  maxDate: Date | undefined;
  className: string | undefined;
  onEscape: (() => void) | undefined;
}) {
  const [viewDate, setViewDate] = React.useState(value || new Date());
  const [focusedDate, setFocusedDate] = React.useState(value || new Date());
  const gridRef = React.useRef<HTMLDivElement>(null);

  // Generate calendar grid
  const calendarDays = React.useMemo(() => {
    const monthStart = startOfMonth(viewDate);
    const monthEnd = endOfMonth(viewDate);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [viewDate]);

  const handlePrevMonth = () => {
    setViewDate((prev) => subMonths(prev, 1));
  };

  const handleNextMonth = () => {
    setViewDate((prev) => addMonths(prev, 1));
  };

  const handleDateSelect = (date: Date) => {
    // Check if date is within allowed range
    if (minDate && date < startOfDay(minDate)) return;
    if (maxDate && date > endOfDay(maxDate)) return;

    onChange(date);
  };

  const handleToday = () => {
    const today = new Date();
    if (!isDateDisabled(today)) onChange(today);
  };

  const handleYesterday = () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (!isDateDisabled(yesterday)) onChange(yesterday);
  };

  const handleClear = () => {
    onChange(null);
  };

  // Week day headers (starting from Sunday)
  const weekDays = calendarCopy.weekDays;

  const isDateDisabled = (date: Date) => {
    if (minDate && date < startOfDay(minDate)) return true;
    if (maxDate && date > endOfDay(maxDate)) return true;
    return false;
  };
  const today = new Date();
  const yesterday = addDays(today, -1);

  const moveFocus = (nextDate: Date) => {
    setFocusedDate(nextDate);
    if (!isSameMonth(nextDate, viewDate)) setViewDate(startOfMonth(nextDate));
    window.requestAnimationFrame(() => {
      gridRef.current
        ?.querySelector<HTMLButtonElement>(
          `[data-calendar-date="${format(nextDate, "yyyy-MM-dd")}"]`
        )
        ?.focus();
    });
  };

  const handleGridKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, date: Date) => {
    let nextDate: Date | null = null;
    switch (event.key) {
      case "ArrowLeft":
        nextDate = addDays(date, -1);
        break;
      case "ArrowRight":
        nextDate = addDays(date, 1);
        break;
      case "ArrowUp":
        nextDate = addDays(date, -7);
        break;
      case "ArrowDown":
        nextDate = addDays(date, 7);
        break;
      case "Home":
        nextDate = addDays(date, -date.getDay());
        break;
      case "End":
        nextDate = addDays(date, 6 - date.getDay());
        break;
      case "PageUp":
        nextDate = event.shiftKey ? addYears(date, -1) : addMonths(date, -1);
        break;
      case "PageDown":
        nextDate = event.shiftKey ? addYears(date, 1) : addMonths(date, 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        handleDateSelect(date);
        return;
      case "Escape":
        event.preventDefault();
        onEscape?.();
        return;
      default:
        return;
    }
    event.preventDefault();
    moveFocus(nextDate);
  };

  return (
    <div className={cn("w-[280px] p-3", className)}>
      {/* Shortcuts */}
      {showShortcuts && (
        <div className={cn("grid gap-1 mb-3", showClearShortcut ? "grid-cols-3" : "grid-cols-2")}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 text-xs"
            onClick={handleToday}
            disabled={isDateDisabled(today)}
          >
            {calendarCopy.today}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 text-xs"
            onClick={handleYesterday}
            disabled={isDateDisabled(yesterday)}
          >
            {calendarCopy.yesterday}
          </Button>
          {showClearShortcut ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11 text-xs text-muted-foreground"
              onClick={handleClear}
            >
              {calendarCopy.clear}
            </Button>
          ) : null}
        </div>
      )}

      {/* Month Navigation */}
      <div className="flex items-center justify-between mb-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11"
          onClick={handlePrevMonth}
          aria-label={calendarCopy.previousMonth}
        >
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
        </Button>
        <div className="font-semibold text-sm">
          {calendarCopy.dateFormat({
            year: format(viewDate, "yyyy"),
            month: format(viewDate, "M"),
          })}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11"
          onClick={handleNextMonth}
          aria-label={calendarCopy.nextMonth}
        >
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>

      {/* Week Day Headers */}
      <div className="grid grid-cols-7 mb-1">
        {weekDays.map((day) => (
          <div
            key={day}
            className="h-8 flex items-center justify-center text-xs text-muted-foreground font-medium"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div ref={gridRef} role="grid" className="grid grid-cols-7 gap-0.5">
        {calendarDays.map((date) => {
          const isCurrentMonth = isSameMonth(date, viewDate);
          const isSelected = value && isSameDay(date, value);
          const isTodayDate = isToday(date);
          const disabled = isDateDisabled(date);

          return (
            <div
              key={date.toISOString()}
              role="gridcell"
              aria-selected={Boolean(isSelected)}
              aria-disabled={disabled}
            >
              <button
                type="button"
                data-calendar-date={format(date, "yyyy-MM-dd")}
                onClick={() => handleDateSelect(date)}
                onKeyDown={(event) => handleGridKeyDown(event, date)}
                disabled={disabled}
                tabIndex={isSameDay(date, focusedDate) ? 0 : -1}
                aria-current={isTodayDate ? "date" : undefined}
                className={cn(
                  "size-11 rounded-md text-sm flex items-center justify-center",
                  "transition-colors relative",
                  "hover:bg-accent",
                  !isCurrentMonth && "text-muted-foreground/40",
                  isCurrentMonth && "text-foreground",
                  isSelected && "bg-primary text-primary-foreground hover:bg-primary/90",
                  isTodayDate &&
                    !isSelected &&
                    "ring-1 ring-primary ring-inset text-primary font-medium",
                  disabled && "opacity-30 cursor-not-allowed hover:bg-transparent"
                )}
              >
                {format(date, "d")}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Helper functions
function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}
