import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  entryCategories,
  ledgerEntries,
  sourceDocumentFiles,
  sourceDocuments,
} from "@/persistence";
import type {
  ReclassificationDocumentGroup,
  ReclassificationSubject,
} from "@/modules/ledger/domain/reclassification-protocol";

/**
 * Entries grouped by the source document their evidence hangs off. Entries
 * whose document is deleted are absent.
 */
export async function loadReclassificationDocumentGroups(input: {
  ledgerId: string;
  ledgerEntryIds: readonly string[];
}): Promise<readonly ReclassificationDocumentGroup[]> {
  if (input.ledgerEntryIds.length === 0) return [];
  const rows = await db
    .select({
      ledgerEntryId: ledgerEntries.id,
      entryPosition: ledgerEntries.position,
      itemName: ledgerEntries.itemName,
      description: ledgerEntries.description,
      amount: ledgerEntries.amount,
      currency: ledgerEntries.currency,
      currentCategoryId: ledgerEntries.categoryId,
      currentCategoryName: entryCategories.name,
      sourceDocumentId: sourceDocuments.id,
      documentTitle: sourceDocuments.title,
      documentDate: sourceDocuments.documentDate,
      inputText: sourceDocuments.inputText,
      storedFileId: sourceDocumentFiles.storedFileId,
      storedFilePosition: sourceDocumentFiles.position,
    })
    .from(ledgerEntries)
    .innerJoin(
      sourceDocuments,
      and(
        eq(sourceDocuments.id, ledgerEntries.sourceDocumentId),
        eq(sourceDocuments.ledgerId, input.ledgerId)
      )
    )
    .leftJoin(
      entryCategories,
      and(
        eq(entryCategories.id, ledgerEntries.categoryId),
        eq(entryCategories.ledgerId, input.ledgerId)
      )
    )
    // The file join is a LEFT join on purpose: a text-only record has no
    // files, and an inner join here would drop its entries from the run
    // entirely instead of merely leaving them without images. The liveness
    // join above stays the only thing that excludes an entry.
    .leftJoin(
      sourceDocumentFiles,
      and(
        eq(sourceDocumentFiles.sourceDocumentId, sourceDocuments.id),
        eq(sourceDocumentFiles.ledgerId, input.ledgerId)
      )
    )
    .where(
      and(
        eq(ledgerEntries.ledgerId, input.ledgerId),
        inArray(ledgerEntries.id, input.ledgerEntryIds)
      )
    )
    .orderBy(ledgerEntries.position, ledgerEntries.id, sourceDocumentFiles.position);

  // The file join repeats each entry once per image, so both the subjects and
  // the file ids are collected into maps keyed by their own id rather than
  // appended per row.
  interface GroupAccumulator {
    sourceDocumentId: string;
    title: string | null;
    documentDate: string | null;
    inputText: string | null;
    files: Map<string, number>;
    subjects: Map<string, { position: number; subject: ReclassificationSubject }>;
  }

  const byDocument = new Map<string, GroupAccumulator>();
  for (const row of rows) {
    let group = byDocument.get(row.sourceDocumentId);
    if (group == null) {
      group = {
        sourceDocumentId: row.sourceDocumentId,
        title: row.documentTitle,
        documentDate: row.documentDate,
        inputText: row.inputText,
        files: new Map(),
        subjects: new Map(),
      };
      byDocument.set(row.sourceDocumentId, group);
    }

    group.subjects.set(row.ledgerEntryId, {
      position: row.entryPosition,
      subject: {
        ledgerEntryId: row.ledgerEntryId,
        itemName: row.itemName,
        description: row.description,
        amount: row.amount,
        currency: row.currency,
        currentCategoryId: row.currentCategoryId,
        currentCategoryName: row.currentCategoryName,
      },
    });

    if (row.storedFileId != null) {
      const position = row.storedFilePosition ?? Number.MAX_SAFE_INTEGER;
      const known = group.files.get(row.storedFileId);
      if (known == null || position < known) group.files.set(row.storedFileId, position);
    }
  }

  const byString = (left: string, right: string): number =>
    left < right ? -1 : left > right ? 1 : 0;

  return [...byDocument.values()]
    .sort((left, right) => byString(left.sourceDocumentId, right.sourceDocumentId))
    .map((group): ReclassificationDocumentGroup => ({
      sourceDocumentId: group.sourceDocumentId,
      title: group.title,
      documentDate: group.documentDate,
      inputText: group.inputText,
      storedFileIds: [...group.files.entries()]
        .sort((left, right) => left[1] - right[1] || byString(left[0], right[0]))
        .map(([storedFileId]) => storedFileId),
      // Document order, not caller order: the model reads the entries in the
      // same sequence as the receipt it is looking at.
      subjects: [...group.subjects.values()]
        .sort(
          (left, right) =>
            left.position - right.position ||
            byString(left.subject.ledgerEntryId, right.subject.ledgerEntryId)
        )
        .map((entry) => entry.subject),
    }));
}
