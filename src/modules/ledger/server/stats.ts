import { withLedgerAccess } from "../access";
import { calculateLedgerStats } from "@/modules/ledger/application/queries/calculate-ledger-stats";
import { serverComposition } from "@/application/server-composition-root";

/**
 * The ledger's totals. The query parses its own filters, so an unvalidated
 * object can never reach the read port through this wrapper.
 */
export const getLedgerStatsAction = withLedgerAccess(
  async (ledgerId: string, query: unknown = {}) =>
    calculateLedgerStats(ledgerId, query, serverComposition.ledgerReads)
);
