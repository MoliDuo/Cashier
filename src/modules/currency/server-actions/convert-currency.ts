"use server";
import { parseConvertCurrencyInput } from "../contract-schemas";
import type { ConvertCurrencyResult } from "../contracts";
import { convertAmount } from "../server/exchange-rates";
import { withLedgerAccess } from "@/modules/ledger/access";

export const convertCurrencyAction = withLedgerAccess(
  async (
    _ledgerId: string,
    amount: string,
    from: string,
    to: string,
    date?: string
  ): Promise<ConvertCurrencyResult> => {
    const input = parseConvertCurrencyInput({
      amount,
      from,
      to,
      ...(date != null ? { date } : {}),
    });
    const { convertedAmount } = await convertAmount({
      amount: input.amount,
      fromCurrency: input.from,
      toCurrency: input.to,
      ...(input.date != null ? { date: input.date } : {}),
    });
    return { converted: convertedAmount };
  }
);
