import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { ledgers } from "@/persistence";
import type { LedgerDto } from "@/modules/ledger/contracts";
import { mapLedgerSettings } from "./settings";

/**
 * The ledger, or null before the account is created. There is exactly one:
 * `uq_ledgers_singleton` refuses a second row. Cached per request, so the page
 * boundary, the session check and every action in one render share a single
 * lookup.
 */
export const getLedger = cache(async (): Promise<LedgerDto | null> => {
  const [row] = await db.select().from(ledgers);
  return row == null
    ? null
    : {
        settings: mapLedgerSettings(row),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
});
