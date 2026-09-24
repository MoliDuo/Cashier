import "server-only";
import { cache } from "react";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { ledgers, users } from "@/persistence";
import type { LedgerDto } from "@/modules/ledger/contracts";
import { mapLedgerSettings } from "./settings";

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
 * The single live ledger, or null when the account is gone or the ledger is
 * ambiguous. Cached per request, so the page boundary, the session check and
 * every action in one render share a single lookup.
 */
export const getLiveLedger = cache(async (userId: string): Promise<LedgerDto | null> => {
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
});
