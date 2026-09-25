import { assertExpenseAmountDirection } from "@/lib/money/expense-amount";
import { and, asc, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { compare } from "@/lib/money/decimal";
import { roundToCurrency } from "@/lib/money/currency-precision";
import { ledgerEntries, ledgers, books, sourceDocuments } from "@/persistence";
import type {
  BatchUpdateSourceDocumentsResultDto,
  SaveSourceDocumentChangesResultDto,
} from "@/modules/source-document/contracts";
import type {
  BatchUpdateSourceDocumentsInput as BatchUpdateSourceDocumentsPayload,
  UpdateSourceDocumentInput as UpdateSourceDocumentPayload,
} from "@/modules/source-document/contract-schemas";
import { ensureExchangeRates } from "@/modules/currency/server/exchange-rates";
import { replaceDocumentEntriesInTransaction } from "./projections/manual-entries";
import {
  lockLedgerForUpdate,
  lockSourceDocumentForUpdate,
  lockSourceDocumentsForUpdate,
} from "@/lib/db/transaction-locks";
import type { UpdateLedgerEntryInput } from "@/modules/ledger/contract-schemas";
import type { BatchEntryDateImpact } from "@/modules/ledger/contracts";

function whereSourceDocumentNotDeleted(ledgerId: string) {
  return eq(sourceDocuments.ledgerId, ledgerId);
}

function whereSourceDocumentNotDeletedId(ledgerId: string, sourceDocumentId: string) {
  return and(whereSourceDocumentNotDeleted(ledgerId), eq(sourceDocuments.id, sourceDocumentId))!;
}

export type AssignBookResult = { ok: true } | { ok: false; reason: "book_unavailable" };

/**
 * Moves a record to another book. The book is not part of what a whole-document
 * save writes, so the move neither checks nor advances the document version.
 */
export async function assignSourceDocumentBook(input: {
  ledgerId: string;
  sourceDocumentId: string;
  bookId: string;
}): Promise<AssignBookResult> {
  return db.transaction(async (tx) => {
    // The ledger row is locked first, like every other aggregate command, so a
    // concurrent book edit and a concurrent processing write cannot interleave.
    await lockLedgerForUpdate(tx, input.ledgerId);
    const document = await lockSourceDocumentForUpdate(tx, input.ledgerId, input.sourceDocumentId);
    if (document.bookId === input.bookId) return { ok: true as const };
    // Checked inside the transaction, not by the caller: a book archived while
    // the form sat open must not silently receive the record, and only here is
    // the row known to still be live. The composite key would accept an
    // archived book, so the archived check cannot be left to the database.
    const target = await tx
      .select({ id: books.id })
      .from(books)
      .where(
        and(
          eq(books.id, input.bookId),
          eq(books.ledgerId, input.ledgerId),
          isNull(books.archivedAt)
        )
      )
      .limit(1)
      .then((rows) => rows[0]);
    if (target == null) return { ok: false as const, reason: "book_unavailable" as const };
    const [updated] = await tx
      .update(sourceDocuments)
      .set({ bookId: input.bookId, updatedAt: new Date() })
      .where(whereSourceDocumentNotDeletedId(input.ledgerId, input.sourceDocumentId))
      .returning({ id: sourceDocuments.id });
    if (updated == null) throw new ConflictError("Source document changed during book edit");
    return { ok: true as const };
  });
}

interface BatchUpdateSourceDocumentsInput {
  ledgerId: string;
  sourceDocumentIds: string[];
  data: BatchUpdateSourceDocumentsPayload;
  ledgerEntryIds?: string[];
}

interface SaveSourceDocumentChangesAdapterInput {
  ledgerId: string;
  sourceDocumentId: string;
  expectedVersion: number;
  sourceDocument?: UpdateSourceDocumentPayload;
  entries: Array<{ ledgerEntryId: string; data: UpdateLedgerEntryInput }>;
}

type QueryExecutor = Pick<typeof db, "select">;

function normalizeCurrency(currency: string | null, fallback = "CNY"): string {
  return currency != null && currency !== "" ? currency : fallback;
}

/** The entries with each patch's fields applied and amounts rounded to their currency. */
function applyEntryPatches(
  entries: readonly (typeof ledgerEntries.$inferSelect)[],
  patches: ReadonlyMap<string, UpdateLedgerEntryInput>,
  mainCurrency: string
) {
  return entries.map((entry) => {
    const patch = patches.get(entry.id);
    const currency = patch?.currency !== undefined ? patch.currency : entry.currency;
    const effectiveCurrency = normalizeCurrency(currency, mainCurrency);
    if (patch?.amount !== undefined || patch?.currency !== undefined) {
      assertExpenseAmountDirection(entry.amount, patch.amount ?? entry.amount, effectiveCurrency);
    }
    return {
      id: entry.id,
      categoryId: patch?.categoryId !== undefined ? patch.categoryId : entry.categoryId,
      amount:
        patch?.amount !== undefined || patch?.currency !== undefined
          ? roundToCurrency(
              patch.amount !== undefined ? String(patch.amount) : entry.amount,
              effectiveCurrency
            )
          : entry.amount,
      currency,
      itemName: patch?.itemName !== undefined ? patch.itemName : entry.itemName,
      description: patch?.description !== undefined ? patch.description : entry.description,
      createdAt: entry.createdAt.toISOString(),
    };
  });
}

/**
 * Caches the rates the documents' foreign-currency entries are read at once
 * they move to `entryDate`. Best effort: the edit commits either way.
 */
async function ensureRatesForDateChange(
  ledgerId: string,
  sourceDocumentIds: readonly string[],
  entryDate: string
): Promise<void> {
  const foreign = await db
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .innerJoin(
      sourceDocuments,
      and(
        eq(sourceDocuments.id, ledgerEntries.sourceDocumentId),
        eq(sourceDocuments.ledgerId, ledgerId)
      )
    )
    .innerJoin(ledgers, eq(ledgers.id, ledgerEntries.ledgerId))
    .where(
      and(
        eq(ledgerEntries.ledgerId, ledgerId),
        inArray(ledgerEntries.sourceDocumentId, [...sourceDocumentIds]),
        sql`${ledgerEntries.currency} <> ${ledgers.mainCurrency}`
      )
    )
    .limit(1);
  if (foreign.length > 0) await ensureExchangeRates([entryDate]);
}

export async function saveSourceDocumentChanges(
  input: SaveSourceDocumentChangesAdapterInput
): Promise<
  import("@/modules/source-document/contracts").VersionedCommandResult<SaveSourceDocumentChangesResultDto>
> {
  const [ledger, document, initialEntries] = await Promise.all([
    db.query.ledgers.findFirst({
      where: eq(ledgers.id, input.ledgerId),
      columns: { mainCurrency: true },
    }),
    db.query.sourceDocuments.findFirst({
      where: whereSourceDocumentNotDeletedId(input.ledgerId, input.sourceDocumentId),
      columns: {
        latestSubmissionRevisionId: true,
        version: true,
        title: true,
        documentDate: true,
        effectiveDate: true,
      },
    }),
    db.query.ledgerEntries.findMany({
      where: and(
        eq(ledgerEntries.ledgerId, input.ledgerId),
        eq(ledgerEntries.sourceDocumentId, input.sourceDocumentId)
      ),
      orderBy: (entries, { asc: orderAscending }) => [
        orderAscending(entries.position),
        orderAscending(entries.createdAt),
        orderAscending(entries.id),
      ],
    }),
  ]);
  if (ledger == null || document == null) throw new NotFoundError("Source document");
  if (document.version !== input.expectedVersion) {
    return {
      ok: false,
      reason: "stale",
      sourceDocumentId: input.sourceDocumentId,
      expectedVersion: input.expectedVersion,
      currentVersion: document.version,
    };
  }
  const patches = new Map(input.entries.map((entry) => [entry.ledgerEntryId, entry.data]));
  if (patches.size !== input.entries.length) {
    throw new ConflictError("A ledger entry may only be updated once");
  }
  const initialEntriesById = new Map(initialEntries.map((entry) => [entry.id, entry]));
  for (const entryId of patches.keys()) {
    if (!initialEntriesById.has(entryId)) {
      throw new NotFoundError("Active ledger entry projection");
    }
  }

  const metadataChanged =
    (input.sourceDocument?.title !== undefined && input.sourceDocument.title !== document.title) ||
    (input.sourceDocument?.documentDate !== undefined &&
      input.sourceDocument.documentDate !== document.documentDate);
  const entriesChanged = input.entries.some(({ ledgerEntryId, data }) => {
    const entry = initialEntriesById.get(ledgerEntryId)!;
    const nextCurrency = data.currency !== undefined ? data.currency : entry.currency;
    const effectiveCurrency = normalizeCurrency(nextCurrency, ledger.mainCurrency);
    return (
      (data.categoryId !== undefined && data.categoryId !== entry.categoryId) ||
      (data.amount !== undefined &&
        compare(roundToCurrency(String(data.amount), effectiveCurrency), entry.amount) !== 0) ||
      (data.currency !== undefined && data.currency !== entry.currency) ||
      (data.itemName !== undefined && data.itemName !== entry.itemName) ||
      (data.description !== undefined && data.description !== entry.description)
    );
  });
  if (!metadataChanged && !entriesChanged) {
    return {
      ok: true,
      sourceDocumentId: input.sourceDocumentId,
      version: input.expectedVersion,
      data: { updatedEntryIds: input.entries.map((entry) => entry.ledgerEntryId) },
    };
  }

  const nextEntries = applyEntryPatches(initialEntries, patches, ledger.mainCurrency);
  const dateChanged =
    input.sourceDocument?.documentDate !== undefined &&
    input.sourceDocument.documentDate !== document.documentDate;
  const convertsDifferently = nextEntries.some((entry) => {
    const previous = initialEntriesById.get(entry.id)!;
    return (
      normalizeCurrency(entry.currency, ledger.mainCurrency) !== ledger.mainCurrency &&
      (dateChanged ||
        compare(entry.amount, previous.amount) !== 0 ||
        entry.currency !== previous.currency)
    );
  });
  if (convertsDifferently) {
    await ensureExchangeRates([input.sourceDocument?.documentDate ?? document.effectiveDate]);
  }

  const committed = await db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx, input.ledgerId);
    const lockedDocument = await lockSourceDocumentForUpdate(
      tx,
      input.ledgerId,
      input.sourceDocumentId
    );
    if (lockedDocument.version !== input.expectedVersion) {
      return { ok: false as const, currentVersion: lockedDocument.version };
    }
    // Writes only the patched fields onto the entries as they are now, so a
    // category another writer set since the draft was loaded survives.
    const previousEntries = await loadProjectionEntriesForDocuments(tx, input.ledgerId, [
      input.sourceDocumentId,
    ]);
    await replaceDocumentEntriesInTransaction(tx, {
      document: lockedDocument,
      previousEntries,
      ledgerId: input.ledgerId,
      sourceDocumentId: input.sourceDocumentId,
      entries: applyEntryPatches(previousEntries, patches, ledger.mainCurrency),
      ...(input.sourceDocument?.title === undefined ? {} : { title: input.sourceDocument.title }),
      ...(input.sourceDocument?.documentDate === undefined
        ? {}
        : { entryDate: input.sourceDocument.documentDate }),
    });
    return { ok: true as const };
  });

  if (!committed.ok) {
    return {
      ok: false,
      reason: "stale",
      sourceDocumentId: input.sourceDocumentId,
      expectedVersion: input.expectedVersion,
      currentVersion: committed.currentVersion,
    };
  }
  return {
    ok: true,
    sourceDocumentId: input.sourceDocumentId,
    version: input.expectedVersion + 1,
    data: { updatedEntryIds: input.entries.map((entry) => entry.ledgerEntryId) },
  };
}

export async function updateSourceDocuments({
  ledgerId,
  sourceDocumentIds: requestedIds,
  data,
  ledgerEntryIds: selectedLedgerEntryIds,
}: BatchUpdateSourceDocumentsInput): Promise<
  BatchUpdateSourceDocumentsResultDto & { impact?: BatchEntryDateImpact }
> {
  const initialDocuments = await db
    .select({
      id: sourceDocuments.id,
      latestSubmissionRevisionId: sourceDocuments.latestSubmissionRevisionId,
      title: sourceDocuments.title,
      documentDate: sourceDocuments.documentDate,
    })
    .from(sourceDocuments)
    .where(and(eq(sourceDocuments.ledgerId, ledgerId), inArray(sourceDocuments.id, requestedIds)))
    .orderBy(asc(sourceDocuments.id));
  if (initialDocuments.length !== requestedIds.length) {
    throw new ConflictError("Source document is not editable");
  }
  const changedDateIds = new Set(
    initialDocuments
      .filter(
        (document) => data.documentDate !== undefined && document.documentDate !== data.documentDate
      )
      .map((document) => document.id)
  );
  const dateChange = data.documentDate !== undefined && changedDateIds.size > 0;
  if (dateChange) {
    await ensureRatesForDateChange(ledgerId, [...changedDateIds], data.documentDate!);
  }

  const transactionResult = await db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx, ledgerId);

    let documents: Array<typeof sourceDocuments.$inferSelect>;
    try {
      documents = await lockSourceDocumentsForUpdate(tx, ledgerId, requestedIds);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new ConflictError("Source documents changed before the batch edit");
      }
      throw error;
    }
    let impact: BatchEntryDateImpact | undefined;
    if (selectedLedgerEntryIds != null) {
      const selectedIds = [...new Set(selectedLedgerEntryIds)].sort();
      const selected = await tx
        .select({ id: ledgerEntries.id, sourceDocumentId: ledgerEntries.sourceDocumentId })
        .from(ledgerEntries)
        .innerJoin(
          sourceDocuments,
          and(
            eq(sourceDocuments.id, ledgerEntries.sourceDocumentId),
            eq(sourceDocuments.ledgerId, ledgerId)
          )
        )
        .where(and(eq(ledgerEntries.ledgerId, ledgerId), inArray(ledgerEntries.id, selectedIds)));
      const selectedDocumentIds = [
        ...new Set(
          selected.flatMap((entry) =>
            entry.sourceDocumentId == null ? [] : [entry.sourceDocumentId]
          )
        ),
      ].sort();
      if (
        selected.length !== selectedIds.length ||
        selectedDocumentIds.length !== requestedIds.length ||
        selectedDocumentIds.some((id, index) => id !== requestedIds[index])
      ) {
        throw new ConflictError("Selected ledger entries changed before the date update");
      }
      const affected = await tx
        .select({ id: ledgerEntries.id })
        .from(ledgerEntries)
        .innerJoin(
          sourceDocuments,
          and(
            eq(sourceDocuments.id, ledgerEntries.sourceDocumentId),
            eq(sourceDocuments.ledgerId, ledgerId)
          )
        )
        .where(
          and(
            eq(ledgerEntries.ledgerId, ledgerId),
            inArray(ledgerEntries.sourceDocumentId, requestedIds)
          )
        );
      impact = {
        selectedEntryCount: selected.length,
        sourceDocumentCount: requestedIds.length,
        affectedEntryCount: affected.length,
        sourceDocumentIds: requestedIds,
      };
    }

    if (dateChange) {
      if (
        initialDocuments.length !== documents.length ||
        initialDocuments.some((initial, index) => {
          const current = documents[index];
          return (
            current == null ||
            initial.id !== current.id ||
            initial.latestSubmissionRevisionId !== current.latestSubmissionRevisionId
          );
        })
      ) {
        throw new ConflictError("Source documents changed before the batch edit");
      }

      const projectionEntries = await loadProjectionEntriesForDocuments(tx, ledgerId, requestedIds);
      // Every requested document must be in a valid state for the batch to
      // commit — but only documents whose title or date actually changes get
      // a new revision; a document already at the target date/title is a
      // true no-op and keeps its current version untouched.
      const changedDocuments = documents.filter((document) => {
        return (
          (data.title !== undefined && data.title !== document.title) ||
          data.documentDate !== document.documentDate
        );
      });
      for (const document of changedDocuments) {
        const entries = projectionEntries.filter((entry) => entry.sourceDocumentId === document.id);
        await replaceDocumentEntriesInTransaction(tx, {
          document,
          previousEntries: entries,
          ledgerId,
          sourceDocumentId: document.id,
          entryDate: data.documentDate!,
          ...(data.title === undefined ? {} : { title: data.title }),
          entries: entries.map((entry) => ({
            id: entry.id,
            categoryId: entry.categoryId,
            amount: entry.amount,
            currency: entry.currency,
            itemName: entry.itemName,
            description: entry.description,
            createdAt: entry.createdAt.toISOString(),
          })),
        });
      }
      return { changedIds: new Set(changedDocuments.map((document) => document.id)), impact };
    }

    // Title-only batch: only documents whose title actually differs get a
    // single-writer `+1`; documents already at the target title are no-ops.
    const changedDocuments = documents.filter(
      (document) => data.title !== undefined && data.title !== document.title
    );
    if (changedDocuments.length > 0) {
      const updated = await tx
        .update(sourceDocuments)
        .set({
          title: data.title,
          version: sql`${sourceDocuments.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            whereSourceDocumentNotDeleted(ledgerId),
            inArray(
              sourceDocuments.id,
              changedDocuments.map((document) => document.id)
            )
          )
        )
        .returning({ id: sourceDocuments.id });
      if (updated.length !== changedDocuments.length) {
        throw new ConflictError("Source documents changed during the batch edit");
      }
    }
    return { changedIds: new Set(changedDocuments.map((document) => document.id)), impact };
  });

  return {
    sourceDocumentIds: requestedIds,
    updatedCount: transactionResult.changedIds.size,
    ...(transactionResult.impact == null ? {} : { impact: transactionResult.impact }),
  };
}

export async function updateLedgerEntryDates(input: {
  ledgerId: string;
  sourceDocumentIds: string[];
  ledgerEntryIds: string[];
  entryDate: string;
}): Promise<{ impact: BatchEntryDateImpact }> {
  const selectedIds = [...new Set(input.ledgerEntryIds)].sort();
  const selected = await db
    .select({ id: ledgerEntries.id, sourceDocumentId: ledgerEntries.sourceDocumentId })
    .from(ledgerEntries)
    .innerJoin(
      sourceDocuments,
      and(
        eq(sourceDocuments.id, ledgerEntries.sourceDocumentId),
        eq(sourceDocuments.ledgerId, input.ledgerId)
      )
    )
    .where(and(eq(ledgerEntries.ledgerId, input.ledgerId), inArray(ledgerEntries.id, selectedIds)));
  if (selected.length !== selectedIds.length) throw new NotFoundError("Selected ledger entry");
  const sourceDocumentIds = [
    ...new Set(
      selected.flatMap((entry) => (entry.sourceDocumentId == null ? [] : [entry.sourceDocumentId]))
    ),
  ].sort();
  const targetIds = input.sourceDocumentIds;
  if (
    sourceDocumentIds.length !== targetIds.length ||
    sourceDocumentIds.some((id, index) => id !== targetIds[index])
  ) {
    throw new NotFoundError("Source document target");
  }
  const result = await updateSourceDocuments({
    ledgerId: input.ledgerId,
    sourceDocumentIds: input.sourceDocumentIds,
    ledgerEntryIds: selectedIds,
    data: { documentDate: input.entryDate },
  });
  if (result.impact == null) throw new ConflictError("Date update impact was not committed");
  return { impact: result.impact };
}

function loadProjectionEntriesForDocuments(
  executor: QueryExecutor,
  ledgerId: string,
  sourceDocumentIds: readonly string[]
) {
  return executor
    .select(getTableColumns(ledgerEntries))
    .from(ledgerEntries)
    .innerJoin(
      sourceDocuments,
      and(
        eq(sourceDocuments.id, ledgerEntries.sourceDocumentId),
        eq(sourceDocuments.ledgerId, ledgerId)
      )
    )
    .where(
      and(
        eq(ledgerEntries.ledgerId, ledgerId),
        inArray(ledgerEntries.sourceDocumentId, [...sourceDocumentIds])
      )
    )
    .orderBy(ledgerEntries.sourceDocumentId, ledgerEntries.position, ledgerEntries.id);
}
