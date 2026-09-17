import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { forLedger } from "@/lib/db/scoped-query";
import { mapLedgerEntryDto } from "./mappers";
import {
  buildLedgerEntryCursorCondition,
  buildLedgerEntryEffectiveDateConditions,
  buildLedgerEntryValueConditions,
  encodeLedgerEntryCursor,
  type LedgerEntryFilterParams,
} from "./build-ledger-entry-filters";
import { ledgerEntries, revisionFiles } from "@/persistence";

interface ListLedgerEntryPageInput {
  ledgerId: string;
  limit?: number;
  cursor?: string | null;
  filters: LedgerEntryFilterParams;
}

interface VisibleEntryRow {
  id: string;
  position: number;
  effectiveDate: string;
  // Drizzle raw executes return timestamptz as strings.
  documentCreatedAt: string;
  documentId: string;
}

export async function listLedgerEntryPage({
  ledgerId,
  limit = 20,
  cursor,
  filters,
}: ListLedgerEntryPageInput) {
  return db.transaction(
    async (tx) => {
      const tenantCondition = forLedger(ledgerEntries, ledgerId).whereActive;
      const cursorCondition = buildLedgerEntryCursorCondition(cursor, ledgerId, filters, {
        effectiveDate: sql`documents.effective_date`,
        documentCreatedAt: sql`documents.created_at`,
        documentId: sql`documents.id`,
        position: sql`ledger_entries.position`,
        entryId: sql`ledger_entries.id`,
      });
      const whereConditions = [
        tenantCondition,
        ...buildLedgerEntryEffectiveDateConditions(filters),
        ...buildLedgerEntryValueConditions(filters),
        cursorCondition,
      ].filter((condition): condition is SQL<unknown> => condition != null);

      // Phase 1: a bounded keyset page over one scan of the active projection.
      // The CTE applies visibility (active revision + soft delete), the
      // accounting-date range, entry filters and the cursor predicate in SQL, so
      // no ordering scalar subquery is re-executed per row or per cursor branch.
      const page = await tx.execute<VisibleEntryRow & Record<string, unknown>>(sql`
    WITH visible_entries AS (
      SELECT
        ledger_entries.id,
        ledger_entries.position,
        ledger_entries.source_document_id,
        ledger_entries.source_document_revision_id,
        documents.effective_date,
        documents.created_at AS document_created_at,
        documents.id AS document_id
      FROM ledger_entries
      INNER JOIN source_documents documents
        ON documents.ledger_id = ledger_entries.ledger_id
       AND documents.id = ledger_entries.source_document_id
       AND documents.deleted_at IS NULL
       AND documents.active_revision_id = ledger_entries.source_document_revision_id
       ${filters.attributedUserId == null ? sql`` : sql`AND documents.attributed_user_id = ${filters.attributedUserId}`}
      WHERE ${sql.join(whereConditions, sql` AND `)}
    )
    SELECT id, position, effective_date::text AS "effectiveDate",
      document_created_at AS "documentCreatedAt", document_id AS "documentId"
    FROM visible_entries
    ORDER BY effective_date DESC, document_created_at DESC, document_id DESC,
      position ASC, id ASC
    LIMIT ${limit + 1}
  `);

      const hasMore = page.rows.length > limit;
      const pagedRows = hasMore ? page.rows.slice(0, limit) : page.rows;

      let nextCursor: string | null = null;
      if (hasMore) {
        const lastItem = pagedRows.at(-1);
        if (lastItem == null) {
          throw new AppError("Expected next ledger entry page cursor row", "INVARIANT_VIOLATION");
        }
        nextCursor = encodeLedgerEntryCursor(
          {
            effectiveDate: lastItem.effectiveDate,
            documentCreatedAt: new Date(lastItem.documentCreatedAt).toISOString(),
            documentId: lastItem.documentId,
            position: lastItem.position,
            entryId: lastItem.id,
          },
          ledgerId,
          filters
        );
      }

      // Phase 2: bounded hydration of exactly the page rows, preserving the
      // keyset order from phase 1.
      const order = new Map(pagedRows.map((row, index) => [row.id, index]));
      const rows =
        pagedRows.length === 0
          ? []
          : await tx.query.ledgerEntries
              .findMany({
                where: and(
                  eq(ledgerEntries.ledgerId, ledgerId),
                  isNull(ledgerEntries.deletedAt),
                  inArray(
                    ledgerEntries.id,
                    pagedRows.map((row) => row.id)
                  ),
                  sql`EXISTS (
                SELECT 1 FROM source_documents active_documents
                WHERE active_documents.ledger_id = ${ledgerEntries.ledgerId}
                  AND active_documents.id = ${ledgerEntries.sourceDocumentId}
                  AND active_documents.deleted_at IS NULL
                  AND active_documents.active_revision_id = ${ledgerEntries.sourceDocumentRevisionId}
              )`
                ),
                with: {
                  category: true,
                  sourceDocument: {
                    columns: {
                      id: true,
                      version: true,
                      ledgerId: true,
                      title: true,
                      documentDate: true,
                      createdAt: true,
                      updatedAt: true,
                      deletedAt: true,
                    },
                  },
                },
                extras: {
                  hasImages: sql<boolean>`EXISTS (
                    SELECT 1
                    FROM ${revisionFiles} page_revision_file
                    WHERE page_revision_file.ledger_id = ${ledgerEntries.ledgerId}
                      AND page_revision_file.revision_id = ${ledgerEntries.sourceDocumentRevisionId}
                  )`.as("has_images"),
                },
              })
              .then((found) =>
                found.toSorted(
                  (left, right) =>
                    (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
                    (order.get(right.id) ?? Number.MAX_SAFE_INTEGER)
                )
              );

      if (rows.length !== pagedRows.length) {
        throw new AppError(
          "Ledger entry page hydration did not match the snapshot page",
          "INVARIANT_VIOLATION"
        );
      }

      const items = rows.map((row) => {
        const dto = mapLedgerEntryDto({
          ...row,
          category: row.category,
          sourceDocument: row.sourceDocument,
        });

        if (dto.sourceDocument != null) {
          dto.sourceDocument = {
            ...dto.sourceDocument,
            hasImages: row.hasImages,
          };
        }

        return dto;
      });

      return {
        items,
        nextCursor,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" }
  );
}
