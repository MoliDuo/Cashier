import type { CurrencyPort } from "@/application/contracts";
import { db } from "@/lib/db";
import { lockLedgerForUpdate } from "../transaction-locks";
import { recalculateCurrentEntries } from "../source-document-aggregate/recalculate-current-entries";

export const postgresCurrencyAdapter: CurrencyPort = {
  async recalculateLedgerForDate(ledgerId, date) {
    const targetDate = date.split("T")[0] ?? date;
    return db.transaction(async (tx) => {
      const ledger = await lockLedgerForUpdate(tx, ledgerId);
      // Entries dated on the event use that date's rates; undated entries use
      // the latest stored rate, so both must be refreshed.
      return recalculateCurrentEntries(tx, ledgerId, ledger.mainCurrency, targetDate, true);
    });
  },
};
