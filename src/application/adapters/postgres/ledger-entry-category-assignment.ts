import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { entryCategories, ledgerEntries, sourceDocuments } from "@/persistence";
import type { EntryCategoryAssignmentPort } from "@/modules/ledger/application/ports";
import type { ReclassificationSubject } from "@/modules/ledger/application/reclassification-protocol";

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
  async loadSubjects(input) {
    if (input.ledgerEntryIds.length === 0) return [];
    const rows = await db
      .select({
        ledgerEntryId: ledgerEntries.id,
        itemName: ledgerEntries.itemName,
        description: ledgerEntries.description,
        amount: ledgerEntries.amount,
        currency: ledgerEntries.currency,
        currentCategoryId: ledgerEntries.categoryId,
        currentCategoryName: entryCategories.name,
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
      .where(
        and(
          eq(ledgerEntries.ledgerId, input.ledgerId),
          inArray(ledgerEntries.id, input.ledgerEntryIds),
          isNull(ledgerEntries.deletedAt)
        )
      )
      .orderBy(ledgerEntries.id);

    const byId = new Map(rows.map((row) => [row.ledgerEntryId, row]));
    // Preserve the caller's order: it is the index base the model answers in.
    return input.ledgerEntryIds.flatMap((id) => {
      const row = byId.get(id);
      return row == null
        ? []
        : [
            {
              ledgerEntryId: row.ledgerEntryId,
              itemName: row.itemName,
              description: row.description,
              amount: row.amount,
              currency: row.currency,
              currentCategoryId: row.currentCategoryId,
              currentCategoryName: row.currentCategoryName,
            } satisfies ReclassificationSubject,
          ];
    });
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
