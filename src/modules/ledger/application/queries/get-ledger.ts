import type { LedgerPort } from "@/application/contracts";
import type { LedgerDto } from "@/modules/ledger/contracts";

export async function getLedger(
  input: { ledgerId: string; userId: string },
  ledgers: Pick<LedgerPort, "getSharedForMember">
): Promise<LedgerDto | null> {
  const shared = await ledgers.getSharedForMember(input.userId);
  const ledger = shared?.id === input.ledgerId ? shared : null;
  return ledger == null
    ? null
    : {
        id: ledger.id,
        settings: ledger.settings,
        createdAt: ledger.createdAt,
        updatedAt: ledger.updatedAt,
      };
}
