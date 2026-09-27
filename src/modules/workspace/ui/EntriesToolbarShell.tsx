import type { ReactNode } from "react";
import { AmountText } from "@/modules/currency/ui/amount-text";

interface EntriesToolbarShellProps {
  children: ReactNode;
  /** The total the list sums to; the period bar under it says which days. */
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
      className={`relative mb-2 flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2 sm:mb-4 ${className}`}
    >
      {totalLabel != null && totalLabel !== "" ? (
        // The total leads the box, centred on a row of its own, so it reads as
        // the page's headline and the controls under it keep the full width.
        <div className="flex min-w-0 basis-full justify-center whitespace-nowrap py-1">
          <AmountText variant="hero">{totalLabel}</AmountText>
        </div>
      ) : null}
      {children}
      {/* The batch band takes the room the browsing controls leave rather than
          a row of its own, so the back control stays on its line. */}
      {batchActions != null ? <div className="min-w-0 flex-1">{batchActions}</div> : null}
    </div>
  );
}
