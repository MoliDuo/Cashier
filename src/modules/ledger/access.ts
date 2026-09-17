import { auth } from "@/auth";
import { serverComposition } from "@/application/server-composition-root";
import { NotFoundError, UnauthorizedError } from "@/lib/errors";
import { isValidUuid } from "@/lib/validation";

export async function requireLedgerAccess(ledgerId: string) {
  const session = await auth();
  const userId = session?.user?.id;
  if (userId == null || userId === "") throw new UnauthorizedError();
  if (!isValidUuid(ledgerId)) throw new NotFoundError("Ledger");
  const shared = await serverComposition.ledgers.getSharedForMember(userId);
  const ledger = shared?.id === ledgerId ? shared : null;
  if (ledger == null) throw new NotFoundError("Ledger");
  return { userId, ledger };
}

export function withLedgerAccess<TArgs extends unknown[], TReturn>(
  action: (ledgerId: string, ...args: TArgs) => Promise<TReturn>
): (ledgerId: string, ...args: TArgs) => Promise<TReturn> {
  return async (ledgerId: string, ...args: TArgs) => {
    await requireLedgerAccess(ledgerId);
    return action(ledgerId, ...args);
  };
}
