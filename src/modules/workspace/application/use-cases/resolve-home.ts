import { cache } from "react";
import type { LedgerPort } from "@/application/contracts";
import type { LedgerContract } from "@/application/contracts";
import { UnauthorizedError } from "@/lib/errors";

const resolveHomeImpl = cache(
  async (
    userId: string,
    ledgers: Pick<LedgerPort, "getSharedForMember">
  ): Promise<LedgerContract> => {
    const ledger = await ledgers.getSharedForMember(userId);
    if (ledger == null) throw new UnauthorizedError("Shared ledger is unavailable");
    return ledger;
  }
);

export async function resolveHome(
  userId: string,
  ledgers: Pick<LedgerPort, "getSharedForMember">
): Promise<LedgerContract> {
  return resolveHomeImpl(userId, ledgers);
}
