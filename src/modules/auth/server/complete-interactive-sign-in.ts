import "server-only";
import { UnauthorizedError } from "@/lib/errors";
import type { AuthenticatedPrincipal } from "@/modules/auth/contracts";
import { getLiveLedger } from "@/modules/ledger/server/live-ledger";

/**
 * Complete the cross-domain part of an interactive sign-in.
 *
 * The authenticators check an account only. This is the one place that also
 * insists the shared ledger is there before the session is handed out.
 */
export async function completeInteractiveSignIn(
  principal: AuthenticatedPrincipal
): Promise<AuthenticatedPrincipal> {
  const ledger = await getLiveLedger(principal.id);
  if (ledger == null) throw new UnauthorizedError("Shared ledger is unavailable");
  return principal;
}
