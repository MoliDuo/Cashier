import type { UserAccountPort } from "@/application/contracts";
import { resolveDevPartner } from "@/modules/auth/dev-auth";

export interface DevPartnerOption {
  /** What to label the second dev sign-in entry with. */
  label: string;
}

/**
 * Resolves the second dev sign-in entry. `resolveDevPartner` already refuses to
 * resolve outside local dev, so production never reads the partner account.
 */
export async function getDevPartnerOption(
  users: UserAccountPort
): Promise<DevPartnerOption | null> {
  const partner = await resolveDevPartner(users);
  return partner == null ? null : { label: partner.name ?? partner.email };
}
