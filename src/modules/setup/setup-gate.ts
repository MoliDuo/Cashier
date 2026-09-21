import "server-only";
import { redirect } from "next/navigation";
import { serverComposition } from "@/application/server-composition-root";

/**
 * Setup runs once and never un-runs: the wizard deletes the `setup_state` row
 * as it creates the account, and nothing puts the instance back. So the first
 * answer of "no longer pending" is the last one, and this process need not ask
 * again. Wiping the database behind a running instance would outlive the cache,
 * but that already needs a restart to be a coherent reset.
 */
let setupSettled = false;

/**
 * Sends a page to the wizard while the instance has no account yet.
 *
 * This runs in the server components that gate a route — the protected layout
 * and the login page — rather than in the middleware, because deciding it needs
 * the database and the middleware runs on the edge runtime. A request that has
 * already resolved a session never reaches here, so it costs one query only on
 * the two entry points a first visitor can land on.
 */
export async function redirectToSetupIfPending(locale: string): Promise<void> {
  if (setupSettled) return;
  // `redirect` throws, so the instance is only recorded as settled on the path
  // that actually saw an account.
  if (await serverComposition.setup.isPending()) redirect(`/${locale}/setup`);
  setupSettled = true;
}
