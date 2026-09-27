import type { ReactNode } from "react";
import { AmountText } from "@/modules/currency/ui/amount-text";
import { usePublishHeaderTotal } from "@/modules/workspace/store";

interface EntriesToolbarShellProps {
  children: ReactNode;
  /** The total the list sums to; the period bar beside it says which days. */
  totalLabel?: string | undefined;
  batchActions?: ReactNode | undefined;
  className?: string;
}

export function EntriesToolbarShell({
  children,
  totalLabel,
  batchActions,
  className = "",
}: EntriesToolbarShellProps) {
  const total = totalLabel != null && totalLabel !== "" ? totalLabel : null;
  // A phone prints the total in the top bar, between the book and the gear;
  // from md up that bar holds the tabs, so the total stays on this row.
  usePublishHeaderTotal(total);

  return (
    <div
      data-testid="entries-toolbar"
      // The right inset is one row's own: the box's 1px border plus `pr-3`
      // lands the total on the same column as the amounts in the cards below,
      // which are inset by their border plus the row's `px-3`. `p-2` on the
      // right would leave the total 4px proud of them.
      className={`relative mb-2 flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2 pr-3 sm:mb-4 ${className}`}
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
  );
}
