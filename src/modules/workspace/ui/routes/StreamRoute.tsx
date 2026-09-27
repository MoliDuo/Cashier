"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { usePeriodFilter } from "../../hooks/usePeriodFilter";
import { LedgerEntriesTab } from "../LedgerEntriesTab";
import { useLedgerWorkspace } from "../ledger-workspace-context";

/** 流水: every record, newest first, under the route's own filters. */
export function StreamRoute() {
  const { ledger, recordScope, timeZone, today } = useLedgerWorkspace();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { period, filterParams, handleFiltersChange, handlePeriodChange } = usePeriodFilter({
    pathname,
    searchParams,
  });

  return (
    <LedgerEntriesTab
      bookId={recordScope ?? undefined}
      ledger={ledger}
      period={period}
      today={today}
      onPeriodChange={handlePeriodChange}
      onFiltersChange={handleFiltersChange}
      advancedFilters={filterParams}
      collapseEntriesDefault={ledger.settings.collapseEntriesDefault}
      timeZone={timeZone}
    />
  );
}
