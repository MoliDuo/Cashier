import type { ReactNode } from "react";
import { EntriesToolbarShell } from "./EntriesToolbarShell";

interface DetailsToolbarProps {
  rangeLabel?: string;
  totalLabel?: string;
  children?: ReactNode;
  batchActions?: ReactNode;
}

export function DetailsToolbar({
  rangeLabel,
  totalLabel,
  children,
  batchActions,
}: DetailsToolbarProps) {
  return (
    <EntriesToolbarShell
      rangeLabel={rangeLabel}
      totalLabel={totalLabel}
      batchActions={batchActions}
    >
      {children}
    </EntriesToolbarShell>
  );
}
