"use server";
import { parseConvertCurrencyInput } from "../contract-schemas";
import type { ConvertCurrencyResult } from "../contracts";
import { convertAmount } from "../server/exchange-rates";
import { withLedgerAccess } from "@/modules/ledger/access";
import { AppError } from "@/lib/errors";

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
    const converted = await convertAmount({
      amount: input.amount,
      fromCurrency: input.from,
      toCurrency: input.to,
      ...(input.date != null ? { date: input.date } : {}),
    });
    if (converted == null) {
      throw new AppError("No exchange rate is available", "EXCHANGE_RATES_UNAVAILABLE", 409);
    }
    return { converted };
  }
);
