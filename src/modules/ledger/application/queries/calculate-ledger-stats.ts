import { parseLedgerStatsQuery } from "@/modules/ledger/contract-schemas";
import type { LedgerSummaryDto } from "@/modules/ledger/contracts";
import type { LedgerReadPort } from "../ports";
import { toLedgerEntryFilters } from "./to-ledger-entry-filters";

/**
 * The ledger's totals for one filtered window. It validates here rather than in
 * the transport above it, so the session route and the server-side prefetch
 * cannot disagree about what a query means.
 */
export async function calculateLedgerStats(
  ledgerId: string,
  query: unknown,
  reads: Pick<LedgerReadPort, "calculateStats">
): Promise<LedgerSummaryDto> {
  const validated = parseLedgerStatsQuery(query);
  return reads.calculateStats({
    ledgerId,
    filters: toLedgerEntryFilters(validated),
  });
}
