import { and, eq, inArray, isNull, sql } from "drizzle-orm";
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

/**
 * Direct, non-versioned writes of `ledger_entries.category_id`.
 *
 * The versioned entry aggregate exists to keep a document's projection and its
 * revision consistent. A category assignment is not part of that pair:
 * `source_document_revisions` does not store categories, so moving an entry
 * between categories cannot make the projection contradict its revision, and
 * this write deliberately skips building a revision and incrementing the
 * document's `version`. The cost is that a re-projection rebuilds entries from
 * the parse result and therefore drops these assignments — editing and
 * retrying a document resets its categories. That is acceptable for a
 * single-owner ledger, and it is the same exposure `saveAll`'s category
 * deletion already has.
 *
 * `architecture-rules.mjs` guards writes to the `sourceDocuments` table; this
 * file only reads it, so no gateway registration applies.
 */
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

  async assign(input) {
    if (input.decisions.length === 0) return { appliedCount: 0 };
    const decisions = JSON.stringify(
      input.decisions.map((decision) => ({
        ledger_entry_id: decision.ledgerEntryId,
        category_id: decision.categoryId,
      }))
    );
    const now = new Date();

    // The candidate's ownership is verified in this join rather than only by a
    // pre-flight check: a category deleted between the model call and the write
    // must not be resurrected or cross a ledger boundary, and an unmatched row
    // simply does not update. `IS DISTINCT FROM` keeps no-ops out of RETURNING
    // so an unchanged entry neither counts as applied nor bumps the ledger's
    // sync version (the row trigger fires on every matched row regardless of
    // whether the value changed).
    const updated = await db.execute<{ ledger_entry_id: string }>(sql`
      WITH decisions AS (
        SELECT * FROM jsonb_to_recordset(${decisions}::jsonb) AS value(
          ledger_entry_id uuid,
          category_id uuid
        )
      )
      UPDATE ledger_entries AS entry
      SET category_id = decisions.category_id,
          updated_at = ${now}
      FROM decisions,
           entry_categories AS category,
           source_documents AS document
      WHERE entry.id = decisions.ledger_entry_id
        AND entry.ledger_id = ${input.ledgerId}
        AND entry.deleted_at IS NULL
        AND entry.category_id IS DISTINCT FROM decisions.category_id
        AND category.id = decisions.category_id
        AND category.ledger_id = entry.ledger_id
        AND category.deleted_at IS NULL
        AND document.id = entry.source_document_id
        AND document.ledger_id = entry.ledger_id
        AND document.active_revision_id = entry.source_document_revision_id
        AND document.deleted_at IS NULL
      RETURNING entry.id AS ledger_entry_id
    `);

    return { appliedCount: updated.rows.length };
  },
};
