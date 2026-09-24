import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { ledgerEntries } from "@/persistence";
import { mapLedgerEntryEmbeddedViewDto } from "./mappers";
import type { LedgerEntryEmbeddedViewDto } from "@/modules/ledger/contracts";
import { buildLedgerEntryVisibilityCondition } from "./ledger-entry-visibility";

interface ListLedgerEntryViewsBySourceDocumentIdsInput {
  ledgerId: string;
  sourceDocumentIds: string[];
}

export async function listLedgerEntryViewsBySourceDocumentIds({
  ledgerId,
  sourceDocumentIds,
}: ListLedgerEntryViewsBySourceDocumentIdsInput): Promise<
  Map<string, LedgerEntryEmbeddedViewDto[]>
> {
  const entriesBySourceDocumentId = new Map<string, LedgerEntryEmbeddedViewDto[]>();

  if (sourceDocumentIds.length === 0) {
    return entriesBySourceDocumentId;
  }

  const entries = await db.query.ledgerEntries.findMany({
    where: and(
      eq(ledgerEntries.ledgerId, ledgerId),
      isNull(ledgerEntries.deletedAt),
      inArray(ledgerEntries.sourceDocumentId, sourceDocumentIds),
      buildLedgerEntryVisibilityCondition(ledgerId)
    ),
    with: { category: true },
    orderBy: [
      asc(ledgerEntries.sourceDocumentId),
      asc(ledgerEntries.position),
      asc(ledgerEntries.id),
    ],
  });

  for (const entry of entries) {
    if (entry.sourceDocumentId == null || entry.sourceDocumentId === "") {
      continue;
    }

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
