import "server-only";
import { ledgerToday } from "@/modules/ledger/server/query-period";
import { roundToCurrency } from "@/lib/money/currency-precision";
import { getCategoryName } from "@/modules/ledger/server/categories";
import type { QuickEntryResponseDto } from "@/modules/source-document/contracts";
import { ensureExchangeRates } from "@/modules/currency/server/exchange-rates";
import { createManualDocument } from "./projections/writes";
import type { LedgerSettings } from "@/modules/ledger/contracts";

export interface CreateQuickEntryPayload {
  /** The book the record is filed under. */
  bookId: string;
  /** The ledger's zone, which names the day a record without one gets. */
  timeZone: string;
  categoryId: string;
  amount: string;
  currency?: string;
  itemName?: string;
  description?: string | null;
  entryDate?: string;
}

interface QuickEntryInsertData {
  bookId: string;
  categoryId: string;
  itemName: string | null;
  description: string | null;
  amount: string;
  entryDate: string;
}

async function createQuickEntryAtomically(
  ledgerId: string,
  categoryName: string,
  currency: string,
  data: QuickEntryInsertData
): Promise<{ sourceDocumentId: string; ledgerEntryId: string }> {
  const ledgerEntryId = crypto.randomUUID();
  const itemName = data.itemName ?? categoryName;
  const created = await createManualDocument({
    ledgerId,
    bookId: data.bookId,
    title: itemName,
    entryDate: data.entryDate,
    entries: [
      {
        id: ledgerEntryId,
        categoryId: data.categoryId,
        amount: roundToCurrency(data.amount, currency),
        currency,
        itemName,
        description: data.description,
      },
    ],
  });
  return { sourceDocumentId: created.sourceDocumentId, ledgerEntryId };
}

export async function createQuickEntry(
  ledgerId: string,
  ledger: { settings: Pick<LedgerSettings, "mainCurrency"> },
  payload: CreateQuickEntryPayload
): Promise<QuickEntryResponseDto> {
  const mainCurrency = ledger.settings.mainCurrency;
  const entryCurrency = payload.currency ?? mainCurrency;
  // An explicit entryDate wins; without one the record is dated today in the
  // ledger's zone.
  const entryDate = payload.entryDate ?? ledgerToday(payload.timeZone);

  const [categoryName] = await Promise.all([
    getCategoryName(ledgerId, payload.categoryId),
    entryCurrency === mainCurrency ? undefined : ensureExchangeRates([entryDate]),
  ]);

  const result = await createQuickEntryAtomically(ledgerId, categoryName, entryCurrency, {
    bookId: payload.bookId,
    categoryId: payload.categoryId,
    itemName: payload.itemName ?? null,
    description: payload.description ?? null,
    amount: payload.amount,
    entryDate,
  });

  return {
    sourceDocumentId: result.sourceDocumentId,
    ledgerEntryId: result.ledgerEntryId,
    status: "completed",
  };
}
