"use server";
import { convertAmountsBatch } from "../application/use-cases/convert-amounts-batch";
import { convertCurrency } from "../application/use-cases/convert-currency";
import { parseBatchConvertCurrencyInput, parseConvertCurrencyInput } from "../contract-schemas";
import type {
  BatchConversionItem,
  BatchConvertCurrencyResult,
  ConvertCurrencyResult,
} from "../contracts";
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

export const batchConvertCurrencyAction = withLedgerAccess(
  async (
    _ledgerId: string,
    items: BatchConversionItem[],
    targetCurrency: string
  ): Promise<BatchConvertCurrencyResult> => {
    const parsed = parseBatchConvertCurrencyInput({ items, targetCurrency });

    const results = await convertAmountsBatch(
      parsed.items.map((item) => ({
        amount: item.amount,
        fromCurrency: item.currency,
        toCurrency: parsed.targetCurrency,
        ...(item.date != null ? { date: item.date } : {}),
      })),
      parsed.targetCurrency,
      serverComposition.exchangeRates
    );

    return { results: results.map((item) => item.convertedAmount) };
  }
);
