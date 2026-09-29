import { requireLedgerAccess } from "@/modules/ledger/access";
import { parseEnhancedStatsInput, type GetEnhancedStatsInput } from "../contract-schemas";
import type { EnhancedStatsDto } from "../contracts";
import { queryEnhancedStats } from "./enhanced-stats-query";

export async function getEnhancedStats(input: GetEnhancedStatsInput): Promise<EnhancedStatsDto> {
  const validatedInput = parseEnhancedStatsInput(input);
  await requireLedgerAccess();
  return queryEnhancedStats(validatedInput);
}
