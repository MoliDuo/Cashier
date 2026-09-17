import { formatDateTimeForApi, getDateInTimezone } from "@/lib/date-utils";
import { roundToCurrency } from "@/lib/money/currency-precision";
import { getEntryCategoryName } from "@/modules/ledger/source-document-queries";
import type { QuickEntryResponseDto } from "@/modules/source-document/contracts";
import type { QuickEntryPorts } from "../ports";
import type { LedgerSettingsContract } from "@/application/contracts";

export interface CreateQuickEntryPayload {
  attributedUserId?: string;
  createdByUserId?: string;
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
  attributedUserId?: string;
  createdByUserId?: string;
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
    ...(data.attributedUserId === undefined ? {} : { attributedUserId: data.attributedUserId }),
    ...(data.createdByUserId === undefined ? {} : { createdByUserId: data.createdByUserId }),
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
  ledger: { settings: Pick<LedgerSettingsContract, "mainCurrency" | "timeZone"> },
  payload: CreateQuickEntryPayload,
  ports: QuickEntryPorts
): Promise<QuickEntryResponseDto> {
  const mainCurrency = ledger.settings.mainCurrency;
  const entryCurrency = payload.currency ?? mainCurrency;
  const timeZone = ledger.settings.timeZone ?? undefined;
  const entryDate =
    payload.entryDate ?? getDateInTimezone(timeZone) ?? formatDateTimeForApi(new Date());

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
      ...(payload.attributedUserId === undefined
        ? {}
        : { attributedUserId: payload.attributedUserId }),
      ...(payload.createdByUserId === undefined
        ? {}
        : { createdByUserId: payload.createdByUserId }),
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
