"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { EntriesTabSkeleton } from "@/components/skeletons/TabSkeletons";
import { usePeriodFilter } from "../../hooks/usePeriodFilter";
import { LedgerEntriesTab } from "../LedgerEntriesTab";
import { useLedgerWorkspace } from "../ledger-workspace-context";

/** 流水: every record, newest first, under the route's own filters. */
export function StreamRoute() {
  const { ledger, recordScope, effectiveTimeZone, timeZoneReady } = useLedgerWorkspace();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { periodParams, filterParams, handleFiltersChange } = usePeriodFilter({
    pathname,
    searchParams,
    ...(effectiveTimeZone != null ? { timeZone: effectiveTimeZone } : {}),
  });

  if (!timeZoneReady) return <EntriesTabSkeleton />;
  return (
    <LedgerEntriesTab
      bookId={recordScope ?? undefined}
      ledger={ledger}
      periodParams={periodParams}
      onFiltersChange={handleFiltersChange}
      advancedFilters={filterParams}
      collapseEntriesDefault={ledger.settings.collapseEntriesDefault}
      {...(effectiveTimeZone != null ? { timeZone: effectiveTimeZone } : {})}
    />
  );
}
