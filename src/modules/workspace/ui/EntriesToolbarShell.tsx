import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AmountText } from "@/modules/currency/ui/amount-text";
import { ListControlsDrop } from "./ListControlsDrop";

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

  return (
    <ListControlsDrop
      summary={browsing == null ? null : { total, ...browsing }}
      data-testid="entries-toolbar"
      // The right inset is one row's own: the box's 1px border plus `pr-3`
      // lands the total on the same column as the amounts in the cards below,
      // which are inset by their border plus the row's `px-3`. `p-2` on the
      // right would leave the total 4px proud of them.
      className={cn(
        "relative mb-2 flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2 pr-3 sm:mb-4",
        className
      )}
    >
      {children}
      {/* From md up the top bar holds the tabs, so the total stays on this row. */}
      {total != null ? (
        <div className="ml-auto hidden min-w-0 items-center whitespace-nowrap md:flex">
          <AmountText variant="summary">{total}</AmountText>
        </div>
      ) : null}
      {/* The batch band takes the room the browsing controls leave rather than
          a row of its own, so the back control stays on its line. */}
      {batchActions != null ? <div className="min-w-0 flex-1">{batchActions}</div> : null}
    </ListControlsDrop>
  );
}
