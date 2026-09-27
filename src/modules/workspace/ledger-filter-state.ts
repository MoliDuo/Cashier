import type { EntryFilters } from "@/modules/ledger/filters";
import type { LedgerAdvancedFilters } from "@/modules/ledger/ledger-query";

/** The filters a list shows in its dialog, from the ones its URL carries. */
export function buildLedgerEntryFilters(advancedFilters: LedgerAdvancedFilters = {}): EntryFilters {
  const nextFilters: EntryFilters = {};
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
