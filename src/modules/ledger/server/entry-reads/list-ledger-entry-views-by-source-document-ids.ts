import { asc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { ledgerEntries } from "@/persistence";
import {
  entryConvertedAmountSql,
  entryExchangeRateSql,
} from "@/modules/currency/server/conversion-sql";
import { mapLedgerEntryEmbeddedViewDto } from "./mappers";
import type { LedgerEntryEmbeddedViewDto } from "@/modules/ledger/contracts";

interface ListLedgerEntryViewsBySourceDocumentIdsInput {
  sourceDocumentIds: string[];
}

export async function listLedgerEntryViewsBySourceDocumentIds({
  sourceDocumentIds,
}: ListLedgerEntryViewsBySourceDocumentIdsInput): Promise<
  Map<string, LedgerEntryEmbeddedViewDto[]>
> {
  const entriesBySourceDocumentId = new Map<string, LedgerEntryEmbeddedViewDto[]>();

  if (sourceDocumentIds.length === 0) {
    return entriesBySourceDocumentId;
  }

  const entries = await db.query.ledgerEntries.findMany({
    where: inArray(ledgerEntries.sourceDocumentId, sourceDocumentIds),
    with: { category: true },
    extras: {
      convertedAmount: entryConvertedAmountSql().as("converted_amount"),
      exchangeRate: entryExchangeRateSql().as("exchange_rate"),
    },
    orderBy: [
      asc(ledgerEntries.sourceDocumentId),
      asc(ledgerEntries.position),
      asc(ledgerEntries.id),
    ],
  });

  for (const entry of entries) {
    const list = entriesBySourceDocumentId.get(entry.sourceDocumentId) ?? [];
    list.push(
      mapLedgerEntryEmbeddedViewDto({
        ...entry,
        category: entry.category,
      })
    );
    entriesBySourceDocumentId.set(entry.sourceDocumentId, list);
  }

  return entriesBySourceDocumentId;
}
