"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { DetailsTabSkeleton } from "@/components/skeletons/TabSkeletons";
import { usePeriodFilter } from "../../hooks/usePeriodFilter";
import { DetailsTab } from "../DetailsTab";
import { useLedgerWorkspace } from "../ledger-workspace-context";

/** 明细: the entries themselves, under the route's own filters. */
export function DetailsRoute() {
  const { ledger, categories, recordScope, effectiveTimeZone, timeZoneReady } =
    useLedgerWorkspace();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { periodParams, filterParams, handleFiltersChange } = usePeriodFilter({
    pathname,
    searchParams,
    ...(effectiveTimeZone != null ? { timeZone: effectiveTimeZone } : {}),
  });

  if (!timeZoneReady) return <DetailsTabSkeleton />;
  return (
    <DetailsTab
      bookId={recordScope ?? undefined}
      categories={categories}
      ledger={ledger}
      periodParams={periodParams}
      onFiltersChange={handleFiltersChange}
      advancedFilters={filterParams}
      {...(effectiveTimeZone != null ? { timeZone: effectiveTimeZone } : {})}
    />
  );
}
