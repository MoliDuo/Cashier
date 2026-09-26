import { getCurrentSession } from "@/modules/auth/server/current-session";
import { getLiveLedger } from "./server/live-ledger";
import { NotFoundError, UnauthorizedError } from "@/lib/errors";

/**
 * Resolve the session's account and the single live ledger. The browser never
 * names a ledger: there is only one, so it is always read here.
 */
export async function requireLedgerAccess() {
  const session = await getCurrentSession();
  if (session == null) throw new UnauthorizedError();
  const userId = session.userId;
  const ledger = await getLiveLedger(userId);
  if (ledger == null) throw new NotFoundError("Ledger");
  return { userId, ledger };
}

export function withLedgerAccess<TArgs extends unknown[], TReturn>(
  action: (ledgerId: string, ...args: TArgs) => Promise<TReturn>
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs) => {
    const { ledger } = await requireLedgerAccess();
    return action(ledger.id, ...args);
  };
}
