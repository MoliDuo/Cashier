import type { LedgerPort } from "@/application/contracts";
import type { AuthenticatedPrincipal } from "@/modules/auth/contracts";
import { resolveHome } from "@/modules/workspace/application/use-cases/resolve-home";

/**
 * Complete the cross-domain part of an interactive sign-in.
 *
 * Auth application use cases authenticate an account only. This composition
 * use case is the one place that also insists the shared ledger is there
 * before the session is handed out.
 */
export async function completeInteractiveSignIn(
  principal: AuthenticatedPrincipal,
  dependencies: { ledgers: Pick<LedgerPort, "getSharedForMember"> }
): Promise<AuthenticatedPrincipal> {
  await resolveHome(principal.id, dependencies.ledgers);
  return principal;
}
