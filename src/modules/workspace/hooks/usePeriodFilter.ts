"use client";
import { useCallback, useMemo } from "react";
import type { Period } from "@/modules/ledger/domain/period";
import type { EntryFilters } from "@/modules/ledger/filters";
import { readLedgerFilterParams, updateLedgerSearchParams } from "../ledger-url-params";
import { pushLedgerUrl } from "../ledger-url-navigation";
import { buildLedgerEntryFilters } from "../ledger-filter-state";
import { readPeriodParams, writePeriodParams } from "../period-url-params";
import { trackFilterApply, trackPeriodSwitch } from "../telemetry";

interface UsePeriodFilterParams {
  pathname: string;
  searchParams: URLSearchParams;
}

/**
 * A list route's period and filters, read from its URL and written back to it
 * as history entries of their own. The two change apart: the period from the
 * bar in the toolbar, the filters from their dialog.
 */
export function usePeriodFilter({ pathname, searchParams }: UsePeriodFilterParams) {
  const period = useMemo<Period>(() => readPeriodParams(searchParams), [searchParams]);
  const filterParams = useMemo(() => readLedgerFilterParams(searchParams), [searchParams]);
  const filters: EntryFilters = useMemo(
    () => buildLedgerEntryFilters(filterParams),
    [filterParams]
  );

  const handleFiltersChange = useCallback(
    (next: EntryFilters) => {
      const params = updateLedgerSearchParams(searchParams, {
        categoryId: next.categoryId ?? null,
        currency: next.currency ?? null,
        minAmount: next.minAmount ?? null,
        maxAmount: next.maxAmount ?? null,
        statuses: next.statuses ?? [],
        search: next.search ?? null,
      });
      trackFilterApply(next);
      pushLedgerUrl(pathname, params, "filter");
    },
    [pathname, searchParams]
  );

  const handlePeriodChange = useCallback(
    (next: Period) => {
      trackPeriodSwitch("entries", next);
      pushLedgerUrl(pathname, writePeriodParams(searchParams, next), "filter");
    },
    [pathname, searchParams]
  );

  return { period, filters, filterParams, handleFiltersChange, handlePeriodChange };
}
