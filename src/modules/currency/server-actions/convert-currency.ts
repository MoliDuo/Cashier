"use server";
import { convertCurrency } from "../application/use-cases/convert-currency";
import { parseConvertCurrencyInput } from "../contract-schemas";
import type { ConvertCurrencyResult } from "../contracts";
import { withLedgerAccess } from "@/modules/ledger/access";
import { serverComposition } from "@/application/server-composition-root";

export const convertCurrencyAction = withLedgerAccess(
  async (
    _ledgerId: string,
    amount: string,
    from: string,
    to: string,
    date?: string
  ): Promise<ConvertCurrencyResult> => {
    const result = await convertCurrency(
      parseConvertCurrencyInput({
        amount,
        from,
        to,
        ...(date != null ? { date } : {}),
      }),
      serverComposition.exchangeRates
    );
    return { converted: result.converted };
  }
);
