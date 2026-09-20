import { useMemo } from "react";
import { type PeriodParams } from "@/lib/period-utils";
import { buildLedgerEntryFilters } from "../ledger-filter-state";
import type { LedgerAdvancedFilters } from "../initial-query-state";

export function useLedgerEntriesFilters(
  periodParams: PeriodParams,
  advancedFilters?: LedgerAdvancedFilters,
  timeZone?: string
) {
  const filters = useMemo(
    () => buildLedgerEntryFilters(periodParams, advancedFilters, timeZone),
    [periodParams, advancedFilters, timeZone]
  );

  return {
    filters,
    startDateStr: filters.startDate,
    endDateStr: filters.endDate,
  };
}
