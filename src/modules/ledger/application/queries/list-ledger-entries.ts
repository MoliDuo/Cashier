import { parseListLedgerEntriesInput } from "@/modules/ledger/contract-schemas";
import type { LedgerEntryPageDto } from "@/modules/ledger/contracts";
import type { LedgerReadPort } from "../ports";
import { toLedgerEntryFilters } from "./to-ledger-entry-filters";

/**
 * The ledger's entries, one page at a time. This is the single entry point for
 * the query — the session route and the server-side prefetch both reach it — so
 * it validates its own input and returns the page currency the client expects.
 */
export async function listLedgerEntries(
  ledgerId: string,
  params: unknown,
  reads: Pick<LedgerReadPort, "listEntries">
): Promise<LedgerEntryPageDto> {
  const validated = parseListLedgerEntriesInput(params);
  const result = await reads.listEntries({
    ledgerId,
    limit: validated.limit,
    cursor: validated.cursor ?? null,
    filters: toLedgerEntryFilters(validated),
  });

  return {
    ...result,
    nextCursor: result.nextCursor ?? null,
  };
}
