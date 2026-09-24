import "server-only";
import { DEV_AUTH_EMAIL, isDevAuthBypassEnabled } from "@/modules/auth/dev-auth";
import type { AuthenticatedPrincipal } from "@/modules/auth/contracts";
import { findUserByEmail } from "./users";

/**
 * Local-dev sign-in. There is one account now, so the dev entry resolves the
 * single seeded dev account; there is no second member to switch to.
 */
export async function authenticateDevUser(): Promise<AuthenticatedPrincipal | null> {
  if (!isDevAuthBypassEnabled()) return null;
  return (await findUserByEmail(DEV_AUTH_EMAIL)) ?? null;
}
