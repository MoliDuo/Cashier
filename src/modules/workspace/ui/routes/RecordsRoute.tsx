"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { usePeriodFilter } from "../../hooks/usePeriodFilter";
import { LedgerEntriesTab } from "../LedgerEntriesTab";
import { useLedgerWorkspace } from "../ledger-workspace-context";

/** 账目: every bill, newest first, under the page's filters. */
export function RecordsRoute() {
  const { ledger, categories, recordScope, timeZone, today } = useLedgerWorkspace();
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
      categories={categories}
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
