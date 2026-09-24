import {
  parseEnhancedStatsInput,
  type GetEnhancedStatsInput,
} from "@/modules/stats/contract-schemas";
import type { EnhancedStatsDto } from "@/modules/stats/contracts";
import type { StatsReadPort } from "../ports";

export function getEnhancedStatsQuery(
  ledgerId: string,
  input: GetEnhancedStatsInput,
  stats: Pick<StatsReadPort, "queryEnhanced">
): Promise<EnhancedStatsDto> {
  return stats.queryEnhanced({ ...input, ledgerId });
}

export async function getEnhancedStats(
  ledgerId: string,
  input: unknown,
  stats: Pick<StatsReadPort, "queryEnhanced">
): Promise<EnhancedStatsDto> {
  return getEnhancedStatsQuery(ledgerId, parseEnhancedStatsInput(input), stats);
}
