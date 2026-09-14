import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  entryCategories,
  ledgerEntries,
  revisionFiles,
  sourceDocumentRevisions,
  sourceDocuments,
} from "@/persistence";
import type { EntryCategoryAssignmentPort } from "@/modules/ledger/application/ports";
import type {
  ReclassificationDocumentGroup,
  ReclassificationSubject,
} from "@/modules/ledger/application/reclassification-protocol";

/** Reads live document groups and their evidence; category writes use the aggregate. */
export const postgresEntryCategoryAssignmentAdapter: EntryCategoryAssignmentPort = {
  async loadDocumentGroups(input) {
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
        inputText: sourceDocumentRevisions.inputText,
        storedFileId: revisionFiles.storedFileId,
        storedFilePosition: revisionFiles.position,
      })
      .from(ledgerEntries)
      .innerJoin(
        sourceDocuments,
        and(
          eq(sourceDocuments.id, ledgerEntries.sourceDocumentId),
          eq(sourceDocuments.ledgerId, input.ledgerId),
          eq(sourceDocuments.activeRevisionId, ledgerEntries.sourceDocumentRevisionId),
          isNull(sourceDocuments.deletedAt)
        )
      )
      .leftJoin(
        entryCategories,
        and(
          eq(entryCategories.id, ledgerEntries.categoryId),
          eq(entryCategories.ledgerId, input.ledgerId),
          isNull(entryCategories.deletedAt)
        )
      )
      // Both evidence joins are LEFT joins on purpose: a text-only submission
      // has no revision_files, and an inner join here would drop its entries
      // from the run entirely instead of merely leaving them without images.
      // The liveness join above stays the only thing that excludes an entry.
      .leftJoin(
        sourceDocumentRevisions,
        and(
          eq(sourceDocumentRevisions.id, sourceDocuments.activeRevisionId),
          eq(sourceDocumentRevisions.ledgerId, input.ledgerId)
        )
      )
      .leftJoin(
        revisionFiles,
        and(
          eq(revisionFiles.revisionId, sourceDocuments.activeRevisionId),
          eq(revisionFiles.ledgerId, input.ledgerId)
        )
      )
      .where(
        and(
          eq(ledgerEntries.ledgerId, input.ledgerId),
          inArray(ledgerEntries.id, input.ledgerEntryIds),
          isNull(ledgerEntries.deletedAt)
        )
      )
      .orderBy(ledgerEntries.position, ledgerEntries.id, revisionFiles.position);

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
  },
};
