import "server-only";
import { AppError } from "@/lib/errors";
import { withLedgerAccess } from "@/modules/ledger/access";
import { parseConvertCurrencyInput } from "../contract-schemas";
import type { ConvertCurrencyResult } from "../contracts";
import { convertAmount } from "./exchange-rates";

/** A conversion for the signed-in ledger; no stored rate for the day is a 409. */
export const convertCurrency = withLedgerAccess(
  async (_ledgerId: string, rawInput: unknown): Promise<ConvertCurrencyResult> => {
    const input = parseConvertCurrencyInput(rawInput);
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
