import type { ReactNode } from "react";
import { EntriesToolbarShell } from "./EntriesToolbarShell";

interface DetailsToolbarProps {
  rangeLabel?: string;
  totalLabel?: string;
  children?: ReactNode;
  batchActions?: ReactNode;
  onRefresh?: (() => Promise<unknown> | unknown) | undefined;
  isRefreshing?: boolean | undefined;
}

export function DetailsToolbar({
  rangeLabel,
  totalLabel,
  children,
  batchActions,
  onRefresh,
  isRefreshing,
}: DetailsToolbarProps) {
  return (
    <EntriesToolbarShell
      rangeLabel={rangeLabel}
      totalLabel={totalLabel}
      batchActions={batchActions}
      onRefresh={onRefresh}
      isRefreshing={isRefreshing}
    >
      {children}
    </EntriesToolbarShell>
  );
}
