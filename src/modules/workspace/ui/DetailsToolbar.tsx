import type { ReactNode } from "react";
import { EntriesToolbarShell } from "./EntriesToolbarShell";
import { MemberScopeChip } from "./MemberScopeChip";

interface DetailsToolbarProps {
  rangeLabel?: string;
  totalLabel?: string;
  children?: ReactNode;
  batchActions?: ReactNode;
  /** Which member the list is narrowed to, when it is. */
  memberScopeNickname?: string | undefined;
  onRefresh?: (() => Promise<unknown> | unknown) | undefined;
  isRefreshing?: boolean | undefined;
}

export function DetailsToolbar({
  rangeLabel,
  totalLabel,
  children,
  batchActions,
  memberScopeNickname,
  onRefresh,
  isRefreshing,
}: DetailsToolbarProps) {
  return (
    <EntriesToolbarShell
      rangeLabel={rangeLabel}
      totalLabel={totalLabel}
      batchActions={batchActions}
      {...(memberScopeNickname != null
        ? { memberScopeChip: <MemberScopeChip nickname={memberScopeNickname} /> }
        : {})}
      onRefresh={onRefresh}
      isRefreshing={isRefreshing}
    >
      {children}
    </EntriesToolbarShell>
  );
}
