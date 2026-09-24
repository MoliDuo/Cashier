import "server-only";
import { db } from "@/lib/db";
import { lockLedgerForUpdate } from "@/lib/db/transaction-locks";
import { recalculateCurrentEntries } from "@/modules/source-document/server/projections/recalculate-current-entries";

export async function recalculateLedgerForDate(ledgerId: string, date: string): Promise<number> {
  const targetDate = date.split("T")[0] ?? date;
  return db.transaction(async (tx) => {
    const ledger = await lockLedgerForUpdate(tx, ledgerId);
    // Entries dated on the event use that date's rates; undated entries use
    // the latest stored rate, so both must be refreshed.
    return recalculateCurrentEntries(tx, ledgerId, ledger.mainCurrency, targetDate, true);
  });
}
