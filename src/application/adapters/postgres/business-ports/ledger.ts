import { and, eq, isNull } from "drizzle-orm";
import type { LedgerPort } from "@/application/contracts";
import { db } from "@/lib/db";
import { ledgers, users } from "@/persistence";

import { mapLedgerSettings } from "./shared";

async function accountIsActive(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  return rows.length === 1;
}

/**
 * There is one account and one ledger, and both are found by query rather than
 * from configured UUIDs: the `COUPLE_*` config is gone. "Exactly one live row"
 * is what the lookups enforce, so a second live ledger — or a deleted account —
 * closes access instead of widening it.
 */
async function singleLiveLedger() {
  const rows = await db.select().from(ledgers).where(isNull(ledgers.deletedAt)).limit(2);
  return rows.length === 1 ? rows[0]! : null;
}

/**
 * The single live ledger's id, for callers that only need to know which ledger
 * the session is allowed to touch. Exported beside the port so storage adapters
 * do not have to know how "there is one ledger" is decided.
 */
export async function findSingleLiveLedgerId(): Promise<string | null> {
  const rows = await db
    .select({ id: ledgers.id })
    .from(ledgers)
    .where(isNull(ledgers.deletedAt))
    .limit(2);
  return rows.length === 1 ? rows[0]!.id : null;
}

export const postgresLedgerAdapter: LedgerPort = {
  async canAccess(ledgerId, userId) {
    if (!(await accountIsActive(userId))) return false;
    const row = await singleLiveLedger();
    return row != null && row.id === ledgerId;
  },

  async getSharedForMember(userId) {
    if (!(await accountIsActive(userId))) return null;
    const row = await singleLiveLedger();
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
