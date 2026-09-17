import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { LedgerPort } from "@/application/contracts";
import { db } from "@/lib/db";
import { ConflictError } from "@/lib/errors";
import { getCoupleConfig, isCoupleMember } from "@/lib/couple-config";
import { ledgers, users } from "@/persistence";

import { mapLedgerSettings } from "./shared";

async function membersAreActive(ownerId: string, partnerId: string): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        inArray(users.id, [ownerId, partnerId]),
        isNull(users.deletedAt),
        isNotNull(users.registrationCompletedAt)
      )
    );
  return rows.length === 2;
}

export const postgresLedgerAdapter: LedgerPort = {
  async isOwnedByUser(ledgerId, userId) {
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
      .where(
        and(eq(ledgers.id, ledgerId), eq(ledgers.userId, couple.ownerId), isNull(ledgers.deletedAt))
      )
      .limit(1);
    return row.length === 1;
  },

  async getOwned(ledgerId, userId) {
    const couple = getCoupleConfig();
    if (
      couple == null ||
      ledgerId !== couple.ledgerId ||
      !isCoupleMember(userId) ||
      !(await membersAreActive(couple.ownerId, couple.partnerId))
    )
      return null;
    const row = await db.query.ledgers.findFirst({
      where: and(
        eq(ledgers.id, ledgerId),
        eq(ledgers.userId, couple.ownerId),
        isNull(ledgers.deletedAt)
      ),
    });
    return row == null
      ? null
      : {
          id: row.id,
          userId: row.userId,
          settings: mapLedgerSettings(row),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        };
  },
  async listIdsForUser(userId) {
    const couple = getCoupleConfig();
    if (
      couple == null ||
      !isCoupleMember(userId) ||
      !(await membersAreActive(couple.ownerId, couple.partnerId))
    )
      return [];
    const rows = await db
      .select({ id: ledgers.id })
      .from(ledgers)
      .where(
        and(
          eq(ledgers.id, couple.ledgerId),
          eq(ledgers.userId, couple.ownerId),
          isNull(ledgers.deletedAt)
        )
      )
      .orderBy(desc(ledgers.createdAt));
    return rows.map((row) => row.id);
  },
  async listForUser(userId) {
    const couple = getCoupleConfig();
    if (
      couple == null ||
      !isCoupleMember(userId) ||
      !(await membersAreActive(couple.ownerId, couple.partnerId))
    )
      return [];
    const rows = await db.query.ledgers.findMany({
      where: and(
        eq(ledgers.id, couple.ledgerId),
        eq(ledgers.userId, couple.ownerId),
        isNull(ledgers.deletedAt)
      ),
      orderBy: [desc(ledgers.createdAt)],
    });
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      settings: mapLedgerSettings(row),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  },
  async createDefault() {
    throw new ConflictError("Shared ledger must be migrated before sign-in");
  },
  async deleteOwned() {
    return "forbidden";
  },
};
