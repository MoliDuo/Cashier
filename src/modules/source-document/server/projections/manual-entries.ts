import { and, eq, inArray, sql } from "drizzle-orm";
import type { LedgerProjectionEntryContract } from "@/modules/source-document/server/projections/types";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { compare } from "@/lib/money/decimal";
import type { DateOrganizationSuggestion } from "@/modules/source-document/date-organization-contracts";
import { ledgerEntries, sourceDocuments } from "@/persistence";
import type { PostgresTransaction } from "@/lib/db/transaction-locks";
import { assertSourceDocumentNotProcessing } from "../write-guards";

import {
  activeDocumentWhere,
  assertCategoryOwnership,
  assertEntryValues,
  replaceProjection,
  requireCurrency,
} from "./shared";

function nextDateOrganizationSuggestion(
  suggestion: DateOrganizationSuggestion | null,
  entries: readonly LedgerProjectionEntryContract[],
  dateChanged: boolean
): DateOrganizationSuggestion | null | undefined {
  if (suggestion == null) return undefined;
  if (dateChanged) return null;

  const entriesById = new Map(
    entries.flatMap((entry) => (entry.id == null ? [] : [[entry.id, entry] as const]))
  );
  const remainingItems = suggestion.items.filter((item) => {
    const entry = entriesById.get(item.ledgerEntryId);
    return (
      entry != null &&
      entry.itemName === item.snapshot.itemName &&
      compare(entry.amount, item.snapshot.amount) === 0 &&
      (entry.currency ?? "CNY") === item.snapshot.currency
    );
  });
  return remainingItems.length === 0 ? null : { ...suggestion, items: remainingItems };
}

export async function replaceManualProjection(
  tx: PostgresTransaction,
  input: {
    ledgerId: string;
    sourceDocumentId: string;
    entries: readonly LedgerProjectionEntryContract[];
    previousEntries: readonly (typeof ledgerEntries.$inferSelect)[];
  }
): Promise<void> {
  assertEntryValues(input.entries);
  await assertCategoryOwnership(tx, input.ledgerId, input.entries);
  const requestedIds = input.entries.flatMap((entry) => (entry.id == null ? [] : [entry.id]));
  if (new Set(requestedIds).size !== requestedIds.length) {
    throw new ValidationError("A ledger entry may only appear once per source document");
  }

  const previousEntries = input.previousEntries;
  const previousById = new Map(previousEntries.map((entry) => [entry.id, entry]));
  const foreignRequestedIds = requestedIds.filter((id) => !previousById.has(id));
  if (foreignRequestedIds.length > 0) {
    const existing = await tx
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(inArray(ledgerEntries.id, foreignRequestedIds));
    if (existing.length > 0) throw new NotFoundError("Active ledger entry projection");
  }

  const now = new Date();
  const retainedIds = new Set(requestedIds);
  const retainedEntries = previousEntries.filter((previous) => retainedIds.has(previous.id));
  if (retainedEntries.length > 0) {
    // Move the kept entries past every current position before reordering.
    await tx.execute(sql`
      UPDATE ledger_entries entry
      SET position = positions.position + ${Math.max(input.entries.length, ...previousEntries.map((entry) => entry.position + 1))},
          updated_at = ${now}
      FROM (VALUES ${sql.join(
        retainedEntries.map((previous, index) => sql`(${previous.id}::uuid, ${index}::integer)`),
        sql`, `
      )}) AS positions(id, position)
      WHERE entry.id = positions.id
        AND entry.ledger_id = ${input.ledgerId}
    `);
  }

  const removedIds = previousEntries
    .filter((previous) => !retainedIds.has(previous.id))
    .map((previous) => previous.id);
  if (removedIds.length > 0) {
    await tx
      .delete(ledgerEntries)
      .where(
        and(eq(ledgerEntries.ledgerId, input.ledgerId), inArray(ledgerEntries.id, removedIds))
      );
  }

  const newEntries = input.entries.flatMap((entry, position) => {
    const existing = entry.id == null ? null : (previousById.get(entry.id) ?? null);
    return existing == null
      ? [
          {
            id: entry.id ?? crypto.randomUUID(),
            ledgerId: input.ledgerId,
            sourceDocumentId: input.sourceDocumentId,
            position,
            categoryId: entry.categoryId,
            amount: entry.amount,
            currency: requireCurrency(entry.currency),
            itemName: entry.itemName,
            description: entry.description,
            ...(entry.createdAt == null ? {} : { createdAt: new Date(entry.createdAt) }),
          },
        ]
      : [];
  });
  if (newEntries.length > 0) {
    await tx.insert(ledgerEntries).values(newEntries);
  }

  const updatedEntries = input.entries.flatMap((entry, position) => {
    const existing = entry.id == null ? null : (previousById.get(entry.id) ?? null);
    return existing == null
      ? []
      : [
          {
            id: existing.id,
            position,
            categoryId: entry.categoryId,
            amount: entry.amount,
            currency: entry.currency,
            itemName: entry.itemName,
            description: entry.description,
          },
        ];
  });
  if (updatedEntries.length > 0) {
    await tx.execute(sql`
      UPDATE ledger_entries entry
      SET position = updates.position,
          category_id = updates.category_id,
          amount = updates.amount,
          currency = updates.currency,
          item_name = updates.item_name,
          description = updates.description,
          updated_at = ${now}
      FROM (VALUES ${sql.join(
        updatedEntries.map(
          (row) =>
            sql`(
              ${row.id}::uuid,
              ${row.position}::integer,
              ${row.categoryId}::uuid,
              ${row.amount}::numeric,
              ${row.currency}::varchar(3),
              ${row.itemName}::text,
              ${row.description}::text
            )`
        ),
        sql`, `
      )}) AS updates(id, position, category_id, amount, currency, item_name, description)
      WHERE entry.id = updates.id
        AND entry.ledger_id = ${input.ledgerId}
    `);
  }
}

/**
 * Writes a hand edit of the document's entries, title or date. The caller
 * holds the document lock and read `previousEntries` under it; a document being
 * processed is refused, since the parse replaces its entries when it completes.
 */
export async function replaceDocumentEntriesInTransaction(
  tx: PostgresTransaction,
  input: {
    ledgerId: string;
    document: typeof sourceDocuments.$inferSelect;
    previousEntries: readonly (typeof ledgerEntries.$inferSelect)[];
    sourceDocumentId: string;
    entries: readonly LedgerProjectionEntryContract[];
    title?: string;
    entryDate?: string;
  }
): Promise<void> {
  const document = input.document;
  const dateChanged = input.entryDate !== undefined && input.entryDate !== document.documentDate;
  await assertSourceDocumentNotProcessing(tx, document);

  await replaceManualProjection(tx, {
    previousEntries: input.previousEntries,
    ledgerId: input.ledgerId,
    sourceDocumentId: input.sourceDocumentId,
    entries: input.entries,
  });
  const updated = await tx
    .update(sourceDocuments)
    .set({
      version: sql`${sourceDocuments.version} + 1`,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.entryDate === undefined
        ? {}
        : {
            documentDate: input.entryDate,
            ...(dateChanged ? { dateOrganizationSuggestion: null } : {}),
          }),
      ...(!dateChanged && input.document.dateOrganizationSuggestion != null
        ? {
            dateOrganizationSuggestion: nextDateOrganizationSuggestion(
              input.document.dateOrganizationSuggestion,
              input.entries,
              dateChanged
            ),
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(activeDocumentWhere(input.ledgerId, input.sourceDocumentId))
    .returning({ id: sourceDocuments.id })
    .then((rows) => rows[0]);
  if (updated == null) throw new ConflictError("Source document changed during the edit");
}

/** Creates a record typed in by hand, with its input text and entries. */
export async function createCompletedProjectionInTransaction(
  tx: PostgresTransaction,
  input: {
    ledgerId: string;
    sourceDocumentId: string;
    bookId: string;
    title?: string | null;
    entryDate?: string | null;
    inputText?: string | null;
    entries: readonly LedgerProjectionEntryContract[];
  }
): Promise<void> {
  const existing = await tx
    .select({ id: sourceDocuments.id })
    .from(sourceDocuments)
    .where(eq(sourceDocuments.id, input.sourceDocumentId))
    .then((rows) => rows[0]);
  if (existing != null) throw new ConflictError("Source document already exists");
  if (input.bookId == null) throw new ValidationError("A book is required for a new record");

  await tx.insert(sourceDocuments).values({
    id: input.sourceDocumentId,
    ledgerId: input.ledgerId,
    bookId: input.bookId,
    title: input.title ?? null,
    inputText: input.inputText ?? null,
    documentDate: input.entryDate ?? null,
  });
  await replaceProjection(tx, {
    ledgerId: input.ledgerId,
    sourceDocumentId: input.sourceDocumentId,
    entries: input.entries,
  });
}
