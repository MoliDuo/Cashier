import { and, asc, desc, eq, getTableColumns, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { SourceDocumentDetailDto } from "@/modules/source-document/contracts";
import {
  entryCategories,
  ledgerEntries,
  ledgers,
  sourceDocumentFiles,
  sourceDocumentRevisions,
  sourceDocuments,
  storedFiles,
} from "@/persistence";
import type { PostgresTransaction } from "@/lib/db/transaction-locks";
import {
  entryConvertedAmountSql,
  entryExchangeRateSql,
} from "@/modules/currency/server/conversion-sql";

import type { TargetSourceDocumentListInput } from "./filters";
import { baseConditions } from "./filters";
import { cursorCondition, encodeCursor } from "./cursor";
import {
  mapListItem,
  mapSourceDocumentDetail,
  type SourceDocumentLedgerEntryAggregateRow,
  type SourceDocumentHydrationRow,
  type SourceDocumentListHydrationRow,
  type SourceDocumentRow,
  type SourceDocumentStoredFileAggregateRow,
} from "./mappers";

async function loadSourceDocumentDetailSnapshot(
  tx: PostgresTransaction,
  ledgerId: string,
  sourceDocumentId: string
): Promise<{ row: SourceDocumentRow; hydration: SourceDocumentHydrationRow } | null> {
  const baseRow = await tx
    .select({
      ...getTableColumns(sourceDocuments),
      mainCurrency: ledgers.mainCurrency,
      revisionTitle: sourceDocumentRevisions.title,
      latestSubmissionStatus: sourceDocumentRevisions.processingStatus,
      failureKind: sourceDocumentRevisions.failureKind,
      failureMessage: sourceDocumentRevisions.failureMessage,
      failureCode: sourceDocumentRevisions.failureCode,
    })
    .from(sourceDocuments)
    .innerJoin(ledgers, eq(ledgers.id, sourceDocuments.ledgerId))
    .leftJoin(
      sourceDocumentRevisions,
      and(
        eq(sourceDocumentRevisions.ledgerId, ledgerId),
        eq(sourceDocumentRevisions.sourceDocumentId, sourceDocuments.id),
        eq(sourceDocumentRevisions.id, sourceDocuments.latestSubmissionRevisionId)
      )
    )
    .where(
      and(
        eq(sourceDocuments.ledgerId, ledgerId),
        eq(sourceDocuments.id, sourceDocumentId),
        isNull(sourceDocuments.deletedAt)
      )
    )
    .then((rows) => rows[0]);
  if (baseRow == null) return null;

  const fileRows: SourceDocumentStoredFileAggregateRow[] = await tx
    .select({
      id: storedFiles.id,
      contentType: storedFiles.contentType,
      byteSize: storedFiles.byteSize,
      originalFilename: storedFiles.originalFilename,
    })
    .from(sourceDocumentFiles)
    .innerJoin(
      storedFiles,
      and(
        eq(storedFiles.ledgerId, sourceDocumentFiles.ledgerId),
        eq(storedFiles.id, sourceDocumentFiles.storedFileId)
      )
    )
    .where(
      and(
        eq(sourceDocumentFiles.ledgerId, ledgerId),
        eq(sourceDocumentFiles.sourceDocumentId, sourceDocumentId)
      )
    )
    .orderBy(asc(sourceDocumentFiles.position));

  const entryRows = await tx
    .select({
      id: ledgerEntries.id,
      ledgerId: ledgerEntries.ledgerId,
      categoryId: ledgerEntries.categoryId,
      sourceDocumentId: ledgerEntries.sourceDocumentId,
      amount: ledgerEntries.amount,
      currency: ledgerEntries.currency,
      itemName: ledgerEntries.itemName,
      description: ledgerEntries.description,
      convertedAmount: entryConvertedAmountSql(),
      exchangeRate: entryExchangeRateSql(),
      createdAt: ledgerEntries.createdAt,
      updatedAt: ledgerEntries.updatedAt,
      deletedAt: ledgerEntries.deletedAt,
      category: entryCategories,
    })
    .from(ledgerEntries)
    .leftJoin(
      entryCategories,
      and(
        eq(entryCategories.ledgerId, ledgerEntries.ledgerId),
        eq(entryCategories.id, ledgerEntries.categoryId),
        isNull(entryCategories.deletedAt)
      )
    )
    .where(
      and(
        eq(ledgerEntries.ledgerId, ledgerId),
        eq(ledgerEntries.sourceDocumentId, sourceDocumentId),
        isNull(ledgerEntries.deletedAt)
      )
    )
    .orderBy(asc(ledgerEntries.position), asc(ledgerEntries.id));
  const activeEntries: SourceDocumentLedgerEntryAggregateRow[] = entryRows.map((entry) => ({
    id: entry.id,
    ledgerId: entry.ledgerId,
    categoryId: entry.categoryId,
    sourceDocumentId,
    amount: entry.amount,
    currency: entry.currency,
    itemName: entry.itemName,
    description: entry.description,
    convertedAmount: entry.convertedAmount,
    exchangeRate: entry.exchangeRate,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    deletedAt: entry.deletedAt?.toISOString() ?? null,
    category:
      entry.category == null
        ? null
        : {
            ...entry.category,
            createdAt: entry.category.createdAt.toISOString(),
            updatedAt: entry.category.updatedAt.toISOString(),
            deletedAt: entry.category.deletedAt?.toISOString() ?? null,
          },
  }));
  const hydration: SourceDocumentHydrationRow = {
    mainCurrency: baseRow.mainCurrency,
    revisionTitle: baseRow.revisionTitle,
    inputText: baseRow.inputText,
    processingStatus: baseRow.latestSubmissionStatus,
    failureKind: baseRow.failureKind,
    failureMessage: baseRow.failureMessage,
    failureCode: baseRow.failureCode,
    hasImages: fileRows.length > 0,
    files: fileRows,
    ledgerEntries: activeEntries,
  };
  return { row: baseRow, hydration };
}

export async function listTargetSourceDocuments(input: TargetSourceDocumentListInput) {
  const conditions = baseConditions(input);
  const cursor = cursorCondition(input.cursor);
  if (cursor != null) conditions.push(cursor);
  const rows = await db
    .select({
      ...getTableColumns(sourceDocuments),
      revisionTitle: sourceDocumentRevisions.title,
      latestSubmissionStatus: sourceDocumentRevisions.processingStatus,
      failureKind: sourceDocumentRevisions.failureKind,
      failureMessage: sourceDocumentRevisions.failureMessage,
      failureCode: sourceDocumentRevisions.failureCode,
      hasImages: sql<boolean>`EXISTS (
            SELECT 1
            FROM ${sourceDocumentFiles} list_document_file
            INNER JOIN ${storedFiles} list_stored_file
              ON list_stored_file.ledger_id = list_document_file.ledger_id
             AND list_stored_file.id = list_document_file.stored_file_id
            WHERE list_document_file.ledger_id = ${input.ledgerId}
              AND list_document_file.source_document_id = ${sourceDocuments.id}
          )`,
    })
    .from(sourceDocuments)
    .leftJoin(
      sourceDocumentRevisions,
      and(
        eq(sourceDocumentRevisions.ledgerId, input.ledgerId),
        eq(sourceDocumentRevisions.sourceDocumentId, sourceDocuments.id),
        eq(sourceDocumentRevisions.id, sourceDocuments.latestSubmissionRevisionId)
      )
    )
    .where(and(...conditions))
    .orderBy(
      desc(sourceDocuments.effectiveDate),
      desc(sourceDocuments.createdAt),
      desc(sourceDocuments.id)
    )
    .limit(input.limit + 1);
  const hasMore = rows.length > input.limit;
  const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
  const last = pageRows.at(-1);
  return {
    items: pageRows.map((row) => {
      const hydration: SourceDocumentListHydrationRow = {
        revisionTitle: row.revisionTitle,
        processingStatus: row.latestSubmissionStatus,
        failureKind: row.failureKind,
        failureMessage: row.failureMessage,
        failureCode: row.failureCode,
        hasImages: row.hasImages,
      };
      return mapListItem(row, hydration);
    }),
    nextCursor: hasMore && last != null ? encodeCursor(last) : null,
  };
}

export async function getTargetSourceDocument(
  ledgerId: string,
  sourceDocumentId: string
): Promise<SourceDocumentDetailDto | null> {
  return db.transaction((tx) => getSourceDocumentInTransaction(tx, ledgerId, sourceDocumentId), {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}

export async function getSourceDocumentInTransaction(
  tx: PostgresTransaction,
  ledgerId: string,
  sourceDocumentId: string
): Promise<SourceDocumentDetailDto | null> {
  const snapshot = await loadSourceDocumentDetailSnapshot(tx, ledgerId, sourceDocumentId);
  return snapshot == null ? null : mapSourceDocumentDetail(snapshot.row, snapshot.hydration);
}
