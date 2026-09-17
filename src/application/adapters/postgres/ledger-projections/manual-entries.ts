import { and, eq, inArray, isNull, max, or, sql } from "drizzle-orm";
import type { LedgerProjectionEntryContract } from "@/application/contracts";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { compare } from "@/lib/money/decimal";
import type { DateOrganizationSuggestion } from "@/modules/source-document/date-organization-contracts";
import { ledgerEntries, sourceDocumentRevisions, sourceDocuments } from "@/persistence";
import type { PostgresTransaction } from "../transaction-locks";
import {
  assertSourceDocumentNotProcessing,
  hasEditableActiveProjection,
} from "../source-document-write-guards";

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
    revisionId: string;
    entries: readonly LedgerProjectionEntryContract[];
    previousEntries: readonly (typeof ledgerEntries.$inferSelect)[];
  }
): Promise<void> {
  assertEntryValues(input.entries);
  await assertCategoryOwnership(tx, input.ledgerId, input.entries);
  const requestedIds = input.entries.flatMap((entry) => (entry.id == null ? [] : [entry.id]));
  if (new Set(requestedIds).size !== requestedIds.length) {
    throw new ValidationError("A ledger entry may only appear once per manual revision");
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
    // Retained rows move to the new revision in one statement; their positions
    // are appended after the new input entries.
    await tx.execute(sql`
      UPDATE ledger_entries entry
      SET source_document_revision_id = ${input.revisionId},
          position = positions.position + ${input.entries.length},
          updated_at = ${now}
      FROM (VALUES ${sql.join(
        retainedEntries.map((previous, index) => sql`(${previous.id}::uuid, ${index}::integer)`),
        sql`, `
      )}) AS positions(id, position)
      WHERE entry.id = positions.id
        AND entry.ledger_id = ${input.ledgerId}
    `);
  }

  if (retainedEntries.length > 0) {
    // Preserve the historical rows as soft-deleted archives in one insert.
    await tx.insert(ledgerEntries).values(
      retainedEntries.map((previous) => ({
        ...previous,
        id: crypto.randomUUID(),
        deletedAt: now,
        updatedAt: now,
      }))
    );
  }

  const removedIds = previousEntries
    .filter((previous) => !retainedIds.has(previous.id))
    .map((previous) => previous.id);
  if (removedIds.length > 0) {
    await tx
      .update(ledgerEntries)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(ledgerEntries.ledgerId, input.ledgerId),
          inArray(ledgerEntries.id, removedIds),
          isNull(ledgerEntries.deletedAt)
        )
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
            sourceDocumentRevisionId: input.revisionId,
            position,
            categoryId: entry.categoryId,
            amount: entry.amount,
            currency: requireCurrency(entry.currency),
            itemName: entry.itemName,
            description: entry.description,
            convertedAmount: entry.convertedAmount,
            exchangeRate: entry.exchangeRate,
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
            convertedAmount: entry.convertedAmount,
            exchangeRate: entry.exchangeRate,
          },
        ];
  });
  if (updatedEntries.length > 0) {
    await tx.execute(sql`
      UPDATE ledger_entries entry
      SET source_document_revision_id = ${input.revisionId},
          position = updates.position,
          category_id = updates.category_id,
          amount = updates.amount,
          currency = updates.currency,
          item_name = updates.item_name,
          description = updates.description,
          converted_amount = updates.converted_amount,
          exchange_rate = updates.exchange_rate,
          deleted_at = NULL,
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
              ${row.description}::text,
              ${row.convertedAmount}::numeric,
              ${row.exchangeRate}::numeric
            )`
        ),
        sql`, `
      )}) AS updates(id, position, category_id, amount, currency, item_name,
        description, converted_amount, exchange_rate)
      WHERE entry.id = updates.id
        AND entry.ledger_id = ${input.ledgerId}
    `);
  }
}

async function nextRevisionNumber(
  tx: PostgresTransaction,
  sourceDocumentId: string
): Promise<number> {
  const aggregate = await tx
    .select({ value: max(sourceDocumentRevisions.revisionNumber) })
    .from(sourceDocumentRevisions)
    .where(eq(sourceDocumentRevisions.sourceDocumentId, sourceDocumentId))
    .then((rows) => rows[0]);
  return (aggregate?.value ?? 0) + 1;
}

export async function createManualRevision(
  tx: PostgresTransaction,
  input: {
    ledgerId: string;
    sourceDocumentId: string;
    inputText?: string | null;
    revisionId?: string;
    origin: "manual_edit" | "manual_entry";
  }
) {
  const now = new Date();
  const revisionNumber = await nextRevisionNumber(tx, input.sourceDocumentId);
  const revision = await tx
    .insert(sourceDocumentRevisions)
    .values({
      ...(input.revisionId === undefined ? {} : { id: input.revisionId }),
      ledgerId: input.ledgerId,
      sourceDocumentId: input.sourceDocumentId,
      revisionNumber,
      origin: input.origin,
      inputText: input.inputText ?? null,
      processingStatus: null,
      submittedAt: now,
    })
    .returning()
    .then((rows) => rows[0]);
  if (revision == null) throw new ConflictError("Failed to create completed revision");
  return revision;
}

export async function replaceActiveProjectionInTransaction(
  tx: PostgresTransaction,
  input: {
    ledgerId: string;
    document: typeof sourceDocuments.$inferSelect;
    previousEntries: readonly (typeof ledgerEntries.$inferSelect)[];
    sourceDocumentId: string;
    expectedActiveRevisionId: string;
    expectedStateVersion: number;
    revisionId: string;
    entries: readonly LedgerProjectionEntryContract[];
    title?: string;
    entryDate?: string;
  }
): Promise<string> {
  const document = input.document;
  const dateChanged = input.entryDate !== undefined && input.entryDate !== document.documentDate;
  if (document.version !== input.expectedStateVersion) {
    throw new ConflictError("Source document changed during the edit");
  }
  if (!hasEditableActiveProjection(document)) {
    throw new ConflictError("Source document is not editable");
  }
  if (document.activeRevisionId !== input.expectedActiveRevisionId) {
    throw new ConflictError("Source document active revision changed");
  }
  await assertSourceDocumentNotProcessing(tx, document);

  const activeRevision = await tx
    .select({ inputText: sourceDocumentRevisions.inputText })
    .from(sourceDocumentRevisions)
    .where(
      and(
        eq(sourceDocumentRevisions.ledgerId, input.ledgerId),
        eq(sourceDocumentRevisions.sourceDocumentId, input.sourceDocumentId),
        eq(sourceDocumentRevisions.id, input.expectedActiveRevisionId),
        or(
          eq(sourceDocumentRevisions.processingStatus, "completed"),
          isNull(sourceDocumentRevisions.processingStatus)
        )
      )
    )
    .then((rows) => rows[0]);
  if (activeRevision == null) throw new ConflictError("Active revision is not completed");

  const revision = await createManualRevision(tx, {
    ledgerId: input.ledgerId,
    sourceDocumentId: input.sourceDocumentId,
    inputText: activeRevision.inputText,
    origin: "manual_edit",
    revisionId: input.revisionId,
  });
  await copyRevisionFiles(tx, {
    ledgerId: input.ledgerId,
    fromRevisionId: input.expectedActiveRevisionId,
    toRevisionId: revision.id,
  });
  await replaceManualProjection(tx, {
    previousEntries: input.previousEntries,
    ledgerId: input.ledgerId,
    sourceDocumentId: input.sourceDocumentId,
    revisionId: revision.id,
    entries: input.entries,
  });
  const updated = await tx
    .update(sourceDocuments)
    .set({
      activeRevisionId: revision.id,
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
    .where(
      and(
        activeDocumentWhere(input.ledgerId, input.sourceDocumentId),
        eq(sourceDocuments.activeRevisionId, input.expectedActiveRevisionId),
        eq(sourceDocuments.version, input.expectedStateVersion)
      )
    )
    .returning({ id: sourceDocuments.id })
    .then((rows) => rows[0]);
  if (updated == null) throw new ConflictError("Source document changed during the edit");
  return revision.id;
}

export async function copyRevisionFiles(
  tx: PostgresTransaction,
  input: { ledgerId: string; fromRevisionId: string; toRevisionId: string }
): Promise<void> {
  // The source rows are already tenant-scoped by the WHERE clause, so the
  // copy inherits their ownership in a single INSERT ... SELECT.
  await tx.execute(sql`
    INSERT INTO revision_files (ledger_id, revision_id, stored_file_id, position, created_at)
    SELECT ledger_id, ${input.toRevisionId}, stored_file_id, position, now()
    FROM revision_files
    WHERE ledger_id = ${input.ledgerId}
      AND revision_id = ${input.fromRevisionId}
  `);
}

export async function createCompletedProjectionInTransaction(
  tx: PostgresTransaction,
  input: {
    ledgerId: string;
    sourceDocumentId: string;
    attributedUserId?: string;
    createdByUserId?: string;
    revisionId?: string;
    title?: string | null;
    entryDate?: string | null;
    inputText?: string | null;
    copyFilesFromRevisionId?: string;
    entries: readonly LedgerProjectionEntryContract[];
  }
): Promise<string> {
  const existing = await tx
    .select({ id: sourceDocuments.id })
    .from(sourceDocuments)
    .where(eq(sourceDocuments.id, input.sourceDocumentId))
    .then((rows) => rows[0]);
  if (existing != null) throw new ConflictError("Source document already exists");

  await tx.insert(sourceDocuments).values({
    id: input.sourceDocumentId,
    ledgerId: input.ledgerId,
    attributedUserId: input.attributedUserId ?? null,
    createdByUserId: input.createdByUserId ?? null,
    title: input.title ?? null,
    documentDate: input.entryDate ?? null,
  });
  const revision = await createManualRevision(tx, {
    ledgerId: input.ledgerId,
    sourceDocumentId: input.sourceDocumentId,
    origin: "manual_entry",
    ...(input.revisionId === undefined ? {} : { revisionId: input.revisionId }),
    ...(input.inputText !== undefined ? { inputText: input.inputText } : {}),
  });
  if (input.copyFilesFromRevisionId !== undefined) {
    await copyRevisionFiles(tx, {
      ledgerId: input.ledgerId,
      fromRevisionId: input.copyFilesFromRevisionId,
      toRevisionId: revision.id,
    });
  }
  await replaceProjection(tx, {
    ledgerId: input.ledgerId,
    sourceDocumentId: input.sourceDocumentId,
    revisionId: revision.id,
    entries: input.entries,
  });
  await tx
    .update(sourceDocuments)
    .set({ activeRevisionId: revision.id })
    .where(activeDocumentWhere(input.ledgerId, input.sourceDocumentId));
  return revision.id;
}
