import { withLedgerAccess } from "../access";
import { calculateLedgerStats } from "@/modules/ledger/application/queries/calculate-ledger-stats";
import { serverComposition } from "@/application/server-composition-root";
import {
  parseLedgerStatsQuery,
  type LedgerStatsQueryInput,
} from "@/modules/ledger/contract-schemas";

export const getLedgerStatsAction = withLedgerAccess(
  async (ledgerId: string, query: LedgerStatsQueryInput = {}) => {
    const validated = parseLedgerStatsQuery(query);
    return calculateLedgerStats(ledgerId, validated, serverComposition.ledgerReads);
  }
);
