import { requireLedgerAccess } from "@/modules/ledger/access";
import type { LedgerDto } from "@/modules/ledger/contracts";

/**
 * Read through the session query route rather than the action queue, which is
 * why it lives here rather than beside the ledger writers.
 */
export async function getLedgerAction(): Promise<LedgerDto> {
  const { ledger } = await requireLedgerAccess();
  return {
    id: ledger.id,
    settings: ledger.settings,
    createdAt: ledger.createdAt,
    updatedAt: ledger.updatedAt,
  };
}
