import { UNCATEGORIZED_SENTINEL } from "@/modules/ledger/contract-schemas";
import type { LedgerSummaryDto } from "@/modules/ledger/contracts";
import type { LedgerReadPort } from "../ports";
import type { LedgerStatsQueryInput } from "@/modules/ledger/contract-schemas";

export async function calculateLedgerStats(
  ledgerId: string,
  query: LedgerStatsQueryInput,
  reads: Pick<LedgerReadPort, "calculateStats">
): Promise<LedgerSummaryDto> {
  const payload: Parameters<LedgerReadPort["calculateStats"]>[0] = {
    ledgerId,
    filters: {},
  };
  if (query.attributedUserId !== undefined)
    payload.filters.attributedUserId = query.attributedUserId;
  if (query.startDate !== undefined) payload.filters.startDate = query.startDate;
  if (query.endDate !== undefined) payload.filters.endDate = query.endDate;
  // "__uncategorized__" is only a UI/query sentinel; stats must translate it
  // to the same `categoryId = null` semantics used by entry listing.
  const categoryIdCandidate = query.categoryId;
  const isUncategorizedFilter = categoryIdCandidate === UNCATEGORIZED_SENTINEL;
  if (isUncategorizedFilter) {
    payload.filters.uncategorizedOnly = true;
  } else if (categoryIdCandidate !== undefined) {
    payload.filters.categoryId = categoryIdCandidate;
  }
  if (query.currency !== undefined) payload.filters.currency = query.currency;
  if (query.minAmount !== undefined) payload.filters.minAmount = query.minAmount;
  if (query.maxAmount !== undefined) payload.filters.maxAmount = query.maxAmount;
  if (query.search !== undefined) payload.filters.search = query.search;
  return reads.calculateStats(payload);
}
