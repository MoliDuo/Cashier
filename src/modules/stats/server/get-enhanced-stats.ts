import { requireLedgerAccess } from "@/modules/ledger/access";
import { getEnhancedStatsQuery } from "../application/queries/get-enhanced-stats";
import { parseEnhancedStatsInput, type GetEnhancedStatsInput } from "../contract-schemas";
import type { EnhancedStatsDto } from "../contracts";
import { serverComposition } from "@/application/server-composition-root";
import { isCoupleMember } from "@/lib/couple-config";
import { ValidationError } from "@/lib/errors";

export async function getEnhancedStats(input: GetEnhancedStatsInput): Promise<EnhancedStatsDto> {
  const validatedInput = parseEnhancedStatsInput(input);
  await requireLedgerAccess(validatedInput.ledgerId);
  if (validatedInput.attributedUserId != null && !isCoupleMember(validatedInput.attributedUserId)) {
    throw new ValidationError("Invalid member attribution");
  }
  return getEnhancedStatsQuery(validatedInput, serverComposition.stats);
}
