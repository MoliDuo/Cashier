import { withLedgerAccess } from "../access";
import { calculateLedgerStats } from "@/modules/ledger/application/queries/calculate-ledger-stats";
import { serverComposition } from "@/application/server-composition-root";
import {
  parseLedgerStatsQuery,
  type LedgerStatsQueryInput,
} from "@/modules/ledger/contract-schemas";
import { isCoupleMember } from "@/lib/couple-config";
import { ValidationError } from "@/lib/errors";

export const getLedgerStatsAction = withLedgerAccess(
  async (ledgerId: string, query: LedgerStatsQueryInput = {}) => {
    const validated = parseLedgerStatsQuery(query);
    if (validated.attributedUserId != null && !isCoupleMember(validated.attributedUserId))
      throw new ValidationError("Invalid member");
    return calculateLedgerStats(ledgerId, validated, serverComposition.ledgerReads);
  }
);
