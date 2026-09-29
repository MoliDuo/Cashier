import { useEffect, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { MIN_PERIOD_OFFSET, stepPeriod, type Period } from "@/modules/ledger/domain/period";
import { useHeaderSummary, type HeaderSummary } from "@/modules/workspace/store";
import { PeriodPicker } from "./PeriodPicker";

/** The controls the phone's top-bar summary drops down. */
export const LIST_CONTROLS_ID = "ledger-list-controls";

interface ListControlsDropProps extends ComponentProps<"div"> {
  /**
   * What the page is browsing, as the phone's top bar prints it, or null while
   * the controls belong on the page (selecting). With a summary a phone folds
   * the controls into the top bar and drops them down from there; from md up
   * they stay where they are.
   */
  summary: Pick<HeaderSummary, "total" | "period" | "filtered"> | null;
  period: Period;
  /** Today in the ledger's zone, which every period is counted from. */
  today: string;
  onPeriodChange: (period: Period) => void;
  timeZone?: string | undefined;
}

/**
 * A page's period and filter controls, which a phone keeps behind the top
 * bar's summary. The top bar's arrows step the period; dropped down, the
 * controls lead with the period picker, and picking a period folds them. 账目,
 * 明细 and 统计 each put up their own.
 */
export function ListControlsDrop({
  summary,
  period,
  today,
  onPeriodChange,
  timeZone,
  className,
  children,
  ...props
}: ListControlsDropProps) {
  const steps =
    period.range === "all" || period.range === "custom"
      ? null
      : { back: period.offset > MIN_PERIOD_OFFSET[period.range], forward: period.offset < 0 };
  const { open, close } = useHeaderSummary(
    summary == null
      ? null
      : { ...summary, steps, onStep: (by) => onPeriodChange(stepPeriod(period, by)) }
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // A period or filter dialog opened from the controls takes its own Escape.
      const inDialog = event.target instanceof Element && event.target.closest('[role="dialog"]');
      if (event.key === "Escape" && inDialog == null) close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  const dropped = summary != null && open;

  return (
    <>
      {dropped ? (
        // Below the top bar and above the page; the bars stay live, so the
        // summary that opened the controls also folds them.
        <div
          aria-hidden="true"
          className="fixed inset-0 z-10 bg-black/20 md:hidden"
          onClick={close}
        />
      ) : null}
      <div
        {...props}
        id={LIST_CONTROLS_ID}
        className={cn(
          className,
          summary != null &&
            (open
              ? "max-md:fixed max-md:inset-x-3 max-md:top-[calc(4rem+env(safe-area-inset-top))] max-md:z-20 max-md:max-h-[calc(100dvh-9rem-env(safe-area-inset-top))] max-md:overflow-y-auto max-md:shadow-lg"
              : "max-md:hidden")
        )}
      >
        {dropped ? (
          // Mounted per opening, so it opens on the period being viewed.
          <PeriodPicker
            className="w-full md:hidden"
            period={period}
            today={today}
            onChange={(next) => {
              onPeriodChange(next);
              close();
            }}
            {...(timeZone != null ? { timeZone } : {})}
          />
        ) : null}
        {children}
      </div>
    </>
  );
}
