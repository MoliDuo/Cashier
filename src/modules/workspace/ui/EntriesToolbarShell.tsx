import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AmountText } from "@/modules/currency/ui/amount-text";
import { useHeaderSummary } from "@/modules/workspace/store";

/** The toolbar the phone's top-bar summary drops down. */
export const LIST_CONTROLS_ID = "ledger-list-controls";

interface EntriesToolbarShellProps {
  children: ReactNode;
  /** The total the list sums to; the period bar beside it says which days. */
  totalLabel?: string | undefined;
  /**
   * What the list is being browsed by, when it is browsed rather than selected
   * from. A phone then folds the toolbar into the top bar's summary and drops
   * it down from there; while selecting it stays on the page.
   */
  browsing?: { period: string; filtered: boolean } | undefined;
  batchActions?: ReactNode | undefined;
  className?: string;
}

export function EntriesToolbarShell({
  children,
  totalLabel,
  browsing,
  batchActions,
  className = "",
}: EntriesToolbarShellProps) {
  const total = totalLabel != null && totalLabel !== "" ? totalLabel : null;
  // From md up the top bar holds the tabs, so the total stays on this row.
  const { open, close } = useHeaderSummary(browsing == null ? null : { total, ...browsing });

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

  return (
    <>
      {open ? (
        // Below the top bar and above the list; the bars stay live, so the
        // summary that opened the controls also folds them.
        <div
          aria-hidden="true"
          className="fixed inset-0 z-10 bg-black/20 md:hidden"
          onClick={close}
        />
      ) : null}
      <div
        id={LIST_CONTROLS_ID}
        data-testid="entries-toolbar"
        // The right inset is one row's own: the box's 1px border plus `pr-3`
        // lands the total on the same column as the amounts in the cards below,
        // which are inset by their border plus the row's `px-3`. `p-2` on the
        // right would leave the total 4px proud of them.
        className={cn(
          "relative mb-2 flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2 pr-3 sm:mb-4",
          browsing != null &&
            (open
              ? "max-md:fixed max-md:inset-x-3 max-md:top-[calc(4rem+env(safe-area-inset-top))] max-md:z-20 max-md:shadow-lg"
              : "max-md:hidden"),
          className
        )}
      >
        {children}
        {total != null ? (
          <div className="ml-auto hidden min-w-0 items-center whitespace-nowrap md:flex">
            <AmountText variant="summary">{total}</AmountText>
          </div>
        ) : null}
        {/* The batch band takes the room the browsing controls leave rather than
          a row of its own, so the back control stays on its line. */}
        {batchActions != null ? <div className="min-w-0 flex-1">{batchActions}</div> : null}
      </div>
    </>
  );
}
