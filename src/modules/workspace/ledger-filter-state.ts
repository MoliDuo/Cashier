import { type PeriodParams, type PeriodPreset, periodToDateRange } from "@/lib/period-utils";
import type { EntryFilters } from "@/modules/ledger/filters";
import type { LedgerAdvancedFilters } from "./initial-query-state";

export function buildLedgerEntryFilters(
  periodParams: PeriodParams,
  advancedFilters: LedgerAdvancedFilters = {},
  timeZone?: string
): EntryFilters {
  const dateRange = periodToDateRange(periodParams, timeZone);
  const nextFilters: EntryFilters = {};

  if (dateRange.startDate != null) {
    nextFilters.startDate = dateRange.startDate;
  }
  if (dateRange.endDate != null) {
    nextFilters.endDate = dateRange.endDate;
  }
  if (advancedFilters.categoryId !== undefined) {
    nextFilters.categoryId = advancedFilters.categoryId;
  }
  if (advancedFilters.currency !== undefined) {
    nextFilters.currency = advancedFilters.currency;
  }
  if (advancedFilters.minAmount !== undefined) {
    nextFilters.minAmount = advancedFilters.minAmount;
  }
  if (advancedFilters.maxAmount !== undefined) {
    nextFilters.maxAmount = advancedFilters.maxAmount;
  }
  if (advancedFilters.statuses !== undefined) {
    nextFilters.statuses = advancedFilters.statuses;
  }
  if (advancedFilters.search !== undefined) {
    nextFilters.search = advancedFilters.search;
  }
  return nextFilters;
}

export function splitLedgerFilterChange(args: {
  currentPeriod: PeriodParams;
  currentFilters: EntryFilters;
  nextFilters: EntryFilters;
  requestedPeriod?: PeriodPreset;
}): {
  periodUpdate?: PeriodParams;
  advancedFilterUpdate: LedgerAdvancedFilters;
} {
  const currentStartDate = args.currentFilters.startDate ?? null;
  const currentEndDate = args.currentFilters.endDate ?? null;
  const nextStartDate = args.nextFilters.startDate ?? null;
  const nextEndDate = args.nextFilters.endDate ?? null;

  let periodUpdate: PeriodParams | undefined;
  if (args.requestedPeriod != null && args.requestedPeriod !== "custom") {
    // A named preset (thisMonth, lastMonth, week, ...) round-trips through
    // the URL by name instead of being reconstructed as `custom` with
    // explicit dates — otherwise every non-"all" preset loses its identity
    // on the next read and has to be fuzzy-matched back from its computed
    // date range (see EntryFilterPanel's activePreset fallback).
    periodUpdate = { period: args.requestedPeriod };
  } else if (nextStartDate !== currentStartDate || nextEndDate !== currentEndDate) {
    if (nextStartDate != null || nextEndDate != null) {
      periodUpdate = {
        period: "custom",
        ...(nextStartDate != null ? { startDate: nextStartDate } : {}),
        ...(nextEndDate != null ? { endDate: nextEndDate } : {}),
      };
    } else {
      periodUpdate = { period: "thisMonth" };
    }
  }

  const advancedFilterUpdate: LedgerAdvancedFilters = {};
  if ("categoryId" in args.nextFilters) {
    advancedFilterUpdate.categoryId = args.nextFilters.categoryId;
  }
  if ("currency" in args.nextFilters) {
    advancedFilterUpdate.currency = args.nextFilters.currency;
  }
  if ("minAmount" in args.nextFilters) {
    advancedFilterUpdate.minAmount = args.nextFilters.minAmount;
  }
  if ("maxAmount" in args.nextFilters) {
    advancedFilterUpdate.maxAmount = args.nextFilters.maxAmount;
  }
  if ("statuses" in args.nextFilters) {
    advancedFilterUpdate.statuses = args.nextFilters.statuses;
  }
  if ("search" in args.nextFilters) {
    advancedFilterUpdate.search = args.nextFilters.search;
  }
  return {
    ...(periodUpdate != null ? { periodUpdate } : {}),
    advancedFilterUpdate,
  };
}
