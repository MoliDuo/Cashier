import type { LedgerPort, LedgerContract } from "@/application/contracts";
import { getCoupleConfig, isCoupleMember } from "@/lib/couple-config";
import { UnauthorizedError } from "@/lib/errors";

export interface EnsureUserLedgerInput {
  userId: string;
  locale?: string;
}
export interface EnsureUserLedgerResult {
  ledger: LedgerContract;
  created: boolean;
}

export async function resolveSingleLedgerForUser(
  input: EnsureUserLedgerInput,
  ledgers: Pick<LedgerPort, "listForUser" | "createDefault">
): Promise<EnsureUserLedgerResult> {
  return ensureUserLedger(input, ledgers);
}

export async function ensureUserLedger(
  input: EnsureUserLedgerInput,
  ledgers: Pick<LedgerPort, "listForUser" | "createDefault">
): Promise<EnsureUserLedgerResult> {
  const couple = getCoupleConfig();
  if (couple == null || !isCoupleMember(input.userId)) throw new UnauthorizedError();
  const existing = await ledgers.listForUser(input.userId);
  const shared = existing.find((ledger) => ledger.id === couple.ledgerId);
  if (shared != null) return { ledger: shared, created: false };
  throw new UnauthorizedError("Shared ledger is unavailable");
}
