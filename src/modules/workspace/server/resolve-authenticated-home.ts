import "server-only";
import { cache } from "react";
import { getCurrentSession } from "@/modules/auth/server/current-session";
import { getLedger } from "@/modules/ledger/server/live-ledger";
import { UnauthorizedError } from "@/lib/errors";
import type { LedgerDto } from "@/modules/ledger/contracts";

export interface AuthenticatedHomeContext {
  ledgerDto: LedgerDto;
  /** The address the identity provider vouched for at sign-in, when the session recorded one. */
  email: string | null;
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

  const ledger = await getLedger();
  if (ledger == null) throw new UnauthorizedError("Shared ledger is unavailable");

  return { ledgerDto: ledger, email: session.email };
});
