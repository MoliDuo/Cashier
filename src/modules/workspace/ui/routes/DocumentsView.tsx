"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { usePeriodFilter } from "../../hooks/usePeriodFilter";
import { LedgerEntriesTab } from "../LedgerEntriesTab";
import { useLedgerWorkspace } from "../ledger-workspace-context";

/** 账目 by bill: every record, newest first, under the page's filters. */
export function DocumentsView() {
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
