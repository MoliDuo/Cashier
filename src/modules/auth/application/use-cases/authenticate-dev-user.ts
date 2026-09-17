import type { UserAccountPort } from "@/application/contracts";
import { DEV_AUTH_EMAIL, isDevAuthBypassEnabled, resolveDevPartner } from "@/modules/auth/dev-auth";
import { isCoupleMember } from "@/lib/couple-config";
import type { AuthenticatedPrincipal } from "@/modules/auth/contracts";

export async function authenticateDevUser(
  params: { locale?: string; member?: string | null },
  dependencies: { users: UserAccountPort }
): Promise<AuthenticatedPrincipal | null> {
  if (!isDevAuthBypassEnabled()) return null;
  const locale = params.locale ?? "zh-CN";
  if (params.member === "partner") {
    const partner = await resolveDevPartner(dependencies.users);
    return partner == null ? null : { ...partner, locale };
  }
  const user = await dependencies.users.findByEmail(DEV_AUTH_EMAIL);
  return user != null && isCoupleMember(user.id) ? { ...user, locale } : null;
}
