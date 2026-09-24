import { AppError } from "@/lib/errors";
import { add } from "./decimal";
import { roundToCurrency } from "./currency-precision";

/** Accounting totals only contain persisted amounts in the ledger's main currency. */
export function accountingTotal(
  entries: readonly { convertedAmount: string | null }[],
  mainCurrency: string
): string {
  const total = entries.reduce((sum, entry) => {
    if (entry.convertedAmount == null) {
      throw new AppError(
        "Active source document has entries without accounting amounts",
        "ACCOUNTING_AMOUNT_UNAVAILABLE",
        500
      );
    }
    return add(sum, entry.convertedAmount);
  }, "0");
  return roundToCurrency(total, mainCurrency);
}
