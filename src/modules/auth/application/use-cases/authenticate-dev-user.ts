import type { UserAccountPort } from "@/application/contracts";
import { DEV_AUTH_EMAIL, isDevAuthBypassEnabled } from "@/modules/auth/dev-auth";
import type { AuthenticatedPrincipal } from "@/modules/auth/contracts";

/**
 * Local-dev sign-in. There is one account now, so the dev entry resolves the
 * single seeded dev account; there is no second member to switch to.
 */
export async function authenticateDevUser(
  params: { locale?: string },
  dependencies: { users: UserAccountPort }
): Promise<AuthenticatedPrincipal | null> {
  if (!isDevAuthBypassEnabled()) return null;
  const locale = params.locale ?? "zh-CN";
  const user = await dependencies.users.findByEmail(DEV_AUTH_EMAIL);
  return user == null ? null : { ...user, locale };
}
