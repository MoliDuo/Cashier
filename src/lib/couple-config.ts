import { z } from "zod";

const uuid = z.string().uuid();

export function getCoupleConfig() {
  const parsed = z
    .object({
      ownerId: uuid,
      partnerId: uuid,
      ledgerId: uuid,
    })
    .safeParse({
      ownerId: process.env.COUPLE_OWNER_USER_ID,
      partnerId: process.env.COUPLE_PARTNER_USER_ID,
      ledgerId: process.env.COUPLE_LEDGER_ID,
    });
  if (!parsed.success || parsed.data.ownerId === parsed.data.partnerId) return null;
  return parsed.data;
}

export function isCoupleMember(userId: string): boolean {
  const config = getCoupleConfig();
  return config != null && (userId === config.ownerId || userId === config.partnerId);
}

/** The other configured member, or null when `userId` is not one of them. */
export function getPartnerUserId(userId: string): string | null {
  const config = getCoupleConfig();
  if (config == null) return null;
  if (userId === config.ownerId) return config.partnerId;
  if (userId === config.partnerId) return config.ownerId;
  return null;
}
