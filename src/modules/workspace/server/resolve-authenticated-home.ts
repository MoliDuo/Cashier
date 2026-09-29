import "server-only";
import { cache } from "react";
import { getCurrentSession } from "@/modules/auth/server/current-session";
import { getLedger } from "@/modules/ledger/server/live-ledger";
import { UnauthorizedError } from "@/lib/errors";
import type { LedgerDto } from "@/modules/ledger/contracts";

export interface AuthenticatedHomeContext {
  userId: string;
  ledgerDto: LedgerDto;
  session: {
    user?: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  };
}

/**
 * Request-scoped cached helper that resolves the session, the ledger, and
 * ledger access in a single pass. Returns the consolidated context
 * so callers never need to call getCurrentSession(), getLedger(), or
 * requireLedgerAccess() separately within the same render tree.
 */
export const resolveAuthenticatedHome = cache(async (): Promise<AuthenticatedHomeContext> => {
  const session = await getCurrentSession();
  if (session == null) throw new UnauthorizedError();
  const userId = session.userId;

  const ledger = await getLedger();
  if (ledger == null) throw new UnauthorizedError("Shared ledger is unavailable");

  return {
    userId,
    ledgerDto: ledger,
    session: {
      user: {
        id: userId,
        email: session.email,
      },
    },
  };
});
