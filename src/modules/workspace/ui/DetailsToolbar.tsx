import type { ReactNode } from "react";
import { EntriesToolbarShell } from "./EntriesToolbarShell";
import { BookScopeChip } from "./BookScopeChip";

interface DetailsToolbarProps {
  rangeLabel?: string;
  totalLabel?: string;
  children?: ReactNode;
  batchActions?: ReactNode;
  /** Which book the list is narrowed to, when it is. */
  scopeBookName?: string | undefined;
  onRefresh?: (() => Promise<unknown> | unknown) | undefined;
  isRefreshing?: boolean | undefined;
}

export function DetailsToolbar({
  rangeLabel,
  totalLabel,
  children,
  batchActions,
  scopeBookName,
  onRefresh,
  isRefreshing,
}: DetailsToolbarProps) {
  return (
    <EntriesToolbarShell
      rangeLabel={rangeLabel}
      totalLabel={totalLabel}
      batchActions={batchActions}
      {...(scopeBookName != null ? { scopeChip: <BookScopeChip name={scopeBookName} /> } : {})}
      onRefresh={onRefresh}
      isRefreshing={isRefreshing}
    >
      {children}
    </EntriesToolbarShell>
  );
}
