import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { ledgerEntries, sourceDocuments } from "@/persistence";
import type { BatchEntryDateImpact } from "@/modules/ledger/contracts";

export async function getBatchEntryDateImpact(input: {
  ledgerId: string;
  ledgerEntryIds: string[];
}): Promise<BatchEntryDateImpact> {
  const selected = await db
    .select({ id: ledgerEntries.id, sourceDocumentId: ledgerEntries.sourceDocumentId })
    .from(ledgerEntries)
    .innerJoin(
      sourceDocuments,
      and(
        eq(sourceDocuments.id, ledgerEntries.sourceDocumentId),
        eq(sourceDocuments.ledgerId, input.ledgerId),
        isNull(sourceDocuments.deletedAt)
      )
    )
    .where(
      and(
        eq(ledgerEntries.ledgerId, input.ledgerId),
        inArray(ledgerEntries.id, input.ledgerEntryIds),
        isNull(ledgerEntries.deletedAt)
      )
    );
  const sourceDocumentIds = [
    ...new Set(
      selected.flatMap((row) => (row.sourceDocumentId == null ? [] : [row.sourceDocumentId]))
    ),
  ];
  if (selected.length !== input.ledgerEntryIds.length) {
    throw new NotFoundError("Selected ledger entry");
  }
  if (sourceDocumentIds.length === 0) {
    return {
      selectedEntryCount: selected.length,
      sourceDocumentCount: 0,
      affectedEntryCount: 0,
      sourceDocumentIds: [],
    };
  }

  const affected = await db
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .innerJoin(
      sourceDocuments,
      and(
        eq(sourceDocuments.id, ledgerEntries.sourceDocumentId),
        eq(sourceDocuments.activeRevisionId, ledgerEntries.sourceDocumentRevisionId),
        isNull(sourceDocuments.deletedAt)
      )
    )
    .where(
      and(
        eq(ledgerEntries.ledgerId, input.ledgerId),
        inArray(ledgerEntries.sourceDocumentId, sourceDocumentIds),
        isNull(ledgerEntries.deletedAt)
      )
    );

  return {
    selectedEntryCount: selected.length,
    sourceDocumentCount: sourceDocumentIds.length,
    affectedEntryCount: affected.length,
    sourceDocumentIds,
  };
}
