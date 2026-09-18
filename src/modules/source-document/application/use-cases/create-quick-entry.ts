import { formatDateTimeForApi, getDateInTimezone } from "@/lib/date-utils";
import { roundToCurrency } from "@/lib/money/currency-precision";
import { getEntryCategoryName } from "@/modules/ledger/source-document-queries";
import type { QuickEntryResponseDto } from "@/modules/source-document/contracts";
import type { QuickEntryPorts } from "../ports";
import type { LedgerSettingsContract } from "@/application/contracts";

export interface CreateQuickEntryPayload {
  /** The book the record is filed under; also decides its default date zone. */
  bookId: string;
  /** That book's zone; null means the server date decides. */
  timeZone?: string | null;
  categoryId: string;
  amount: string;
  currency?: string;
  itemName?: string;
  description?: string | null;
  entryDate?: string;
}

interface ConversionResult {
  convertedAmount: string;
  exchangeRate: string;
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
  expectedMainCurrency: string,
  categoryName: string,
  currency: string,
  conversion: ConversionResult,
  data: QuickEntryInsertData,
  ports: QuickEntryPorts
): Promise<{ sourceDocumentId: string; ledgerEntryId: string }> {
  const ledgerEntryId = crypto.randomUUID();
  const itemName = data.itemName ?? categoryName;
  const created = await ports.projections.createManual({
    ledgerId,
    bookId: data.bookId,
    expectedMainCurrency,
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
        convertedAmount: conversion.convertedAmount,
        exchangeRate: conversion.exchangeRate,
      },
    ],
  });
  return { sourceDocumentId: created.sourceDocumentId, ledgerEntryId };
}

export async function createQuickEntry(
  ledgerId: string,
  ledger: { settings: Pick<LedgerSettingsContract, "mainCurrency"> },
  payload: CreateQuickEntryPayload,
  ports: QuickEntryPorts
): Promise<QuickEntryResponseDto> {
  const mainCurrency = ledger.settings.mainCurrency;
  const entryCurrency = payload.currency ?? mainCurrency;
  // The record is dated in its book's zone, falling back to the server date.
  const entryDate =
    payload.entryDate ??
    getDateInTimezone(payload.timeZone ?? undefined) ??
    formatDateTimeForApi(new Date());

  const [categoryName, conversion] = await Promise.all([
    getEntryCategoryName(ledgerId, payload.categoryId, ports.categories),
    ports.convertAmount({
      amount: payload.amount,
      fromCurrency: entryCurrency,
      toCurrency: mainCurrency,
      date: entryDate,
    }),
  ]);

  const result = await createQuickEntryAtomically(
    ledgerId,
    mainCurrency,
    categoryName,
    entryCurrency,
    conversion,
    {
      bookId: payload.bookId,
      categoryId: payload.categoryId,
      itemName: payload.itemName ?? null,
      description: payload.description ?? null,
      amount: payload.amount,
      entryDate,
    },
    ports
  );

  return {
    sourceDocumentId: result.sourceDocumentId,
    ledgerEntryId: result.ledgerEntryId,
    status: "completed",
  };
}
