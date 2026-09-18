import { requireLedgerAccess } from "@/modules/ledger/access";
import { getEnhancedStatsQuery } from "../application/queries/get-enhanced-stats";
import { parseEnhancedStatsInput, type GetEnhancedStatsInput } from "../contract-schemas";
import type { EnhancedStatsDto } from "../contracts";
import { serverComposition } from "@/application/server-composition-root";

export async function getEnhancedStats(input: GetEnhancedStatsInput): Promise<EnhancedStatsDto> {
  const validatedInput = parseEnhancedStatsInput(input);
  await requireLedgerAccess(validatedInput.ledgerId);
  return getEnhancedStatsQuery(validatedInput, serverComposition.stats);
}
