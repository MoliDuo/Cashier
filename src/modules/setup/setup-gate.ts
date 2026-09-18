import "server-only";
import { redirect } from "next/navigation";
import { serverComposition } from "@/application/server-composition-root";

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
  if (await serverComposition.setup.isPending()) redirect(`/${locale}/setup`);
}
