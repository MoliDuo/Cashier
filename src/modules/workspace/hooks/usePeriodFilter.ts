"use client";
import { useCallback, useMemo } from "react";
import {
  type PeriodParams,
  type PeriodPreset,
  parsePeriodFromSearchParams,
} from "@/lib/period-utils";
import type { EntryFilters } from "@/modules/ledger/ui/EntryFilterPanel";
import type { SourceDocumentProcessingStatus } from "@/modules/source-document/types";
import {
  getScopedLedgerSearchParams,
  type LedgerFilterScope,
  type LedgerUrlUpdate,
  readLedgerFilterParams,
  updateLedgerSearchParams,
} from "../ledger-url-params";
import { pushLedgerUrl } from "../ledger-url-navigation";
import { buildLedgerEntryFilters, splitLedgerFilterChange } from "../ledger-filter-state";

interface FilterParams {
  categoryId: string | null;
  currency: string | null;
  minAmount: string | null;
  maxAmount: string | null;
  statuses: SourceDocumentProcessingStatus[];
  search: string | null;
}

interface UsePeriodFilterParams {
  pathname: string;
  searchParams: URLSearchParams;
  scope: LedgerFilterScope;
  timeZone?: string;
}

interface UsePeriodFilterReturn {
  periodParams: PeriodParams;
  filters: EntryFilters;
  filterParams: FilterParams;
  handleFiltersChange: (newFilters: EntryFilters, requestedPeriod?: PeriodPreset) => void;
}

function buildPeriodUrlUpdate(
  newPeriod: PeriodParams
): Pick<LedgerUrlUpdate, "period" | "startDate" | "endDate"> {
  const periodUpdate: Pick<LedgerUrlUpdate, "period" | "startDate" | "endDate"> = {
    period: newPeriod.period,
  };

  if (newPeriod.period === "custom") {
    if ("startDate" in newPeriod) {
      periodUpdate.startDate = newPeriod.startDate ?? null;
    }
    if ("endDate" in newPeriod) {
      periodUpdate.endDate = newPeriod.endDate ?? null;
    }
  }

  return periodUpdate;
}

export function usePeriodFilter({
  pathname,
  searchParams,
  scope,
  timeZone,
}: UsePeriodFilterParams): UsePeriodFilterReturn {
  const scopedSearchParams = useMemo(
    () => getScopedLedgerSearchParams(searchParams, scope),
    [scope, searchParams]
  );
  const periodParams = useMemo<PeriodParams>(() => {
    const parsed = parsePeriodFromSearchParams(scopedSearchParams);
    return parsed;
  }, [scopedSearchParams]);

  const filterParams = useMemo<FilterParams>(
    () => readLedgerFilterParams(searchParams, scope),
    [scope, searchParams]
  );

  const filters: EntryFilters = useMemo(
    () => buildLedgerEntryFilters(periodParams, filterParams, timeZone),
    [filterParams, periodParams, timeZone]
  );

  const handleFiltersChange = useCallback(
    (newFilters: EntryFilters, requestedPeriod?: PeriodPreset) => {
      const { periodUpdate, advancedFilterUpdate } = splitLedgerFilterChange({
        currentPeriod: periodParams,
        currentFilters: filters,
        nextFilters: newFilters,
        ...(requestedPeriod !== undefined ? { requestedPeriod } : {}),
      });
      const params = updateLedgerSearchParams(
        searchParams,
        {
          ...(periodUpdate != null ? buildPeriodUrlUpdate(periodUpdate) : {}),
          ...advancedFilterUpdate,
        },
        scope
      );

      pushLedgerUrl(pathname, params, "filter");
    },
    [filters, pathname, periodParams, scope, searchParams]
  );

  return {
    periodParams,
    filters,
    filterParams,
    handleFiltersChange,
  };
}
