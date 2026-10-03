import "server-only";
import { UnauthorizedError } from "@/lib/errors";
import { getLedger } from "@/modules/ledger/server/live-ledger";

/**
 * The cross-domain part of an interactive sign-in: the identity provider vouches
 * for the person, and this insists the shared ledger is there before a session
 * is handed out.
 */
export async function completeInteractiveSignIn(): Promise<void> {
  const ledger = await getLedger();
  if (ledger == null) throw new UnauthorizedError("Shared ledger is unavailable");
}
