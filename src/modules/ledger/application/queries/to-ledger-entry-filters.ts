import { UNCATEGORIZED_SENTINEL } from "@/modules/ledger/contract-schemas";
import type { LedgerEntryFilterParams } from "../../filters";

/** The filters a validated entry query carries, before they are translated. */
export interface LedgerEntryQueryFilters {
  bookId?: string | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  categoryId?: string | undefined;
  currency?: string | undefined;
  minAmount?: string | undefined;
  maxAmount?: string | undefined;
  search?: string | undefined;
}

/**
 * The one translation from a validated query to the read port's filter shape.
 * Listing and statistics ask the same question, so they have to ask it the same
 * way — the uncategorized sentinel above all, which the port never sees: it is
 * an answer of "no category", not the id of one.
 */
export function toLedgerEntryFilters(query: LedgerEntryQueryFilters): LedgerEntryFilterParams {
  const filters: LedgerEntryFilterParams = {};
  if (query.bookId !== undefined) filters.bookId = query.bookId;
  if (query.startDate !== undefined) filters.startDate = query.startDate;
  if (query.endDate !== undefined) filters.endDate = query.endDate;
  if (query.categoryId === UNCATEGORIZED_SENTINEL) {
    filters.uncategorizedOnly = true;
  } else if (query.categoryId !== undefined) {
    filters.categoryId = query.categoryId;
  }
  if (query.currency !== undefined) filters.currency = query.currency;
  if (query.minAmount !== undefined) filters.minAmount = query.minAmount;
  if (query.maxAmount !== undefined) filters.maxAmount = query.maxAmount;
  if (query.search !== undefined) filters.search = query.search;
  return filters;
}
