import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ledgers, users } from "@/persistence";
import type { LedgerDto } from "@/modules/ledger/contracts";
import { mapLedgerSettings } from "./settings";

async function accountExists(userId: string): Promise<boolean> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  return rows.length === 1;
}

/**
 * There is one account and one ledger, and both are found by query rather than
 * from configured UUIDs. "Exactly one row" is what the lookup enforces, so a
 * second ledger closes access instead of widening it.
 */
async function singleLedger() {
  const rows = await db.select().from(ledgers).limit(2);
  return rows.length === 1 ? rows[0]! : null;
}

/**
 * The single ledger, or null when the account is gone or the ledger is
 * ambiguous. Cached per request, so the page boundary, the session check and
 * every action in one render share a single lookup.
 */
export const getLiveLedger = cache(async (userId: string): Promise<LedgerDto | null> => {
  if (!(await accountExists(userId))) return null;
  const row = await singleLedger();
  return row == null
    ? null
    : {
        id: row.id,
        settings: mapLedgerSettings(row),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
});
