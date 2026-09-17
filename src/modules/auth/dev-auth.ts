import type { UserAccountPort } from "@/application/contracts";
import { getPartnerUserId, isCoupleMember } from "@/lib/couple-config";

export const DEV_AUTH_EMAIL = "dev@cashier.local";

/** Which member a dev sign-in targets; unrecognized values mean the dev account. */
export type DevAuthMember = "dev" | "partner";

type DevAuthUser = NonNullable<Awaited<ReturnType<UserAccountPort["findById"]>>>;

export function isDevAuthBypassEnabled(): boolean {
  if (process.env.DEV_AUTH_BYPASS !== "true") return false;
  if (process.env.NODE_ENV === "test") return true;
  if (process.env.NODE_ENV !== "development") return false;
  try {
    const hostname = new URL(process.env.APP_URL ?? "").hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

/**
 * The member the `partner` dev entry signs in as: whichever couple member is not
 * the primary dev account. Returns null outside local dev, when the dev account
 * is not a couple member, or when no partner resolves — so the entry can never
 * reach a user the dev account is unrelated to.
 */
export async function resolveDevPartner(users: UserAccountPort): Promise<DevAuthUser | null> {
  if (!isDevAuthBypassEnabled()) return null;
  const devUser = await users.findByEmail(DEV_AUTH_EMAIL);
  if (devUser == null || !isCoupleMember(devUser.id)) return null;
  const partnerId = getPartnerUserId(devUser.id);
  if (partnerId == null) return null;
  const partner = await users.findById(partnerId);
  return partner != null && isCoupleMember(partner.id) ? partner : null;
}
