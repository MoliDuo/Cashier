import type { ReactNode } from "react";
import { AmountText } from "@/modules/currency/ui/amount-text";

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
      {totalLabel != null && totalLabel !== "" ? (
        // A phone gives the total a row of its own, so the period label beside
        // the filter keeps its room instead of being cut to fit the total.
        <div className="flex min-w-0 basis-full items-center justify-end whitespace-nowrap sm:ml-auto sm:basis-auto">
          <AmountText variant="summary">{totalLabel}</AmountText>
        </div>
      ) : null}
      {/* The batch band takes the room the browsing controls leave rather than
          a row of its own, so the back control stays on its line. */}
      {batchActions != null ? <div className="min-w-0 flex-1">{batchActions}</div> : null}
    </div>
  );
}
