import type { ReactNode } from "react";
import { AmountText } from "@/modules/currency/ui/amount-text";

interface EntriesToolbarShellProps {
  children: ReactNode;
  /** The span the total covers, e.g. 本月 or 2026年9月1日 - 9月30日. A total with
   * no range attached cannot be read on its own. */
  rangeLabel?: string | undefined;
  totalLabel?: string | undefined;
  batchActions?: ReactNode | undefined;
  syncStatus?: ReactNode | undefined;
  className?: string;
}

export function EntriesToolbarShell({
  children,
  rangeLabel,
  totalLabel,
  batchActions,
  syncStatus,
  className = "",
}: EntriesToolbarShellProps) {
  return (
    <div
      data-testid="entries-toolbar"
      // The right inset is one row's own: the box's 1px border plus `pr-3`
      // lands the total on the same column as the amounts in the cards below,
      // which are inset by their border plus the row's `px-3`. `p-2` on the
      // right would leave the total 4px proud of them.
      className={`relative mx-2 mb-2 flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2 pr-3 sm:mb-4 ${className}`}
    >
      {children}
      {syncStatus != null ? (
        <div
          className="order-last min-w-0 basis-full text-xs text-muted-foreground sm:order-none sm:basis-auto"
          data-testid="toolbar-sync-status"
        >
          {syncStatus}
        </div>
      ) : null}
      {rangeLabel != null || (totalLabel != null && totalLabel !== "") ? (
        <div className="ml-auto flex min-w-0 items-center gap-2 whitespace-nowrap">
          {rangeLabel != null ? (
            <span className="text-xs text-muted-foreground sm:text-sm">{rangeLabel}</span>
          ) : null}
          {totalLabel != null && totalLabel !== "" ? (
            <AmountText variant="summary">{totalLabel}</AmountText>
          ) : null}
        </div>
      ) : null}
      {/* The batch band takes the room the browsing controls leave rather than
          a row of its own, so the back control stays on its line. */}
      {batchActions != null ? <div className="min-w-0 flex-1">{batchActions}</div> : null}
    </div>
  );
}
