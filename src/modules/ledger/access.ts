import { getCurrentSession } from "@/modules/auth/server/current-session";
import { getLedger } from "./server/live-ledger";
import { NotFoundError, UnauthorizedError } from "@/lib/errors";

/**
 * Resolve the session's account and the ledger. The browser never names a
 * ledger: there is only one, so a signed-in session reaches it.
 */
export async function requireLedgerAccess() {
  const session = await getCurrentSession();
  if (session == null) throw new UnauthorizedError();
  const ledger = await getLedger();
  if (ledger == null) throw new NotFoundError("Ledger");
  return { userId: session.userId, ledger };
}

/** Run a ledger command for a signed-in session. */
export function withLedgerAccess<TArgs extends unknown[], TReturn>(
  action: (...args: TArgs) => Promise<TReturn>
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs) => {
    await requireLedgerAccess();
    return action(...args);
  };
}
