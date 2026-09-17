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
