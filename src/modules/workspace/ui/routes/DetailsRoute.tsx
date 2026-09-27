"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { usePeriodFilter } from "../../hooks/usePeriodFilter";
import { DetailsTab } from "../DetailsTab";
import { useLedgerWorkspace } from "../ledger-workspace-context";

/** 明细: the entries themselves, under the route's own filters. */
export function DetailsRoute() {
  const { ledger, categories, recordScope, timeZone, today } = useLedgerWorkspace();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { period, filters, filterParams, handleFiltersChange, handlePeriodChange } =
    usePeriodFilter({ pathname, searchParams });

  return (
    <DetailsTab
      bookId={recordScope ?? undefined}
      categories={categories}
      ledger={ledger}
      period={period}
      today={today}
      onPeriodChange={handlePeriodChange}
      filters={filters}
      onFiltersChange={handleFiltersChange}
      advancedFilters={filterParams}
      timeZone={timeZone}
    />
  );
}
