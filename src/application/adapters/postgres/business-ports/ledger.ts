import { and, eq, inArray, isNull } from "drizzle-orm";
import type { LedgerPort } from "@/application/contracts";
import { db } from "@/lib/db";
import { getCoupleConfig, isCoupleMember } from "@/lib/couple-config";
import { ledgers, users } from "@/persistence";

import { mapLedgerSettings } from "./shared";

async function membersAreActive(ownerId: string, partnerId: string): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, [ownerId, partnerId]), isNull(users.deletedAt)));
  return rows.length === 2;
}

export const postgresLedgerAdapter: LedgerPort = {
  async canAccess(ledgerId, userId) {
    const couple = getCoupleConfig();
    if (
      couple == null ||
      ledgerId !== couple.ledgerId ||
      !isCoupleMember(userId) ||
      !(await membersAreActive(couple.ownerId, couple.partnerId))
    )
      return false;
    const row = await db
      .select({ id: ledgers.id })
      .from(ledgers)
      .where(and(eq(ledgers.id, ledgerId), isNull(ledgers.deletedAt)))
      .limit(1);
    return row.length === 1;
  },

  async getSharedForMember(userId) {
    const couple = getCoupleConfig();
    if (
      couple == null ||
      !isCoupleMember(userId) ||
      !(await membersAreActive(couple.ownerId, couple.partnerId))
    )
      return null;
    const row = await db.query.ledgers.findFirst({
      where: and(eq(ledgers.id, couple.ledgerId), isNull(ledgers.deletedAt)),
    });
    return row == null
      ? null
      : {
          id: row.id,
          settings: mapLedgerSettings(row),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        };
  },
};
