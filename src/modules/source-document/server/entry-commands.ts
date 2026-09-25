import { assertExpenseAmountDirection } from "@/lib/money/expense-amount";
import { and, eq, getTableColumns, inArray, isNull } from "drizzle-orm";
import type { LedgerProjectionEntryContract } from "@/modules/source-document/server/projections/types";
import type {
  AtomicBatchCommandResult,
  PartialBatchCommandResult,
  VersionedCommandResult,
  VersionedTarget,
} from "@/modules/source-document/contracts";
import "server-only";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { compare as compareDecimal } from "@/lib/money/decimal";
import { roundToCurrency } from "@/lib/money/currency-precision";
import { ledgerEntries, ledgers, sourceDocuments } from "@/persistence";
import { ensureExchangeRates } from "@/modules/currency/server/exchange-rates";
import { replaceActiveProjectionInTransaction } from "./projections/manual-entries";
import type { PostgresTransaction } from "@/lib/db/transaction-locks";
import {
  lockLedgerForUpdate,
  lockSourceDocumentForUpdate,
  lockSourceDocumentsForUpdate,
} from "@/lib/db/transaction-locks";
import { hasEditableActiveProjection } from "./write-guards";
import { assertCategoryOwnership } from "./projections/shared";

type EntryResult = VersionedCommandResult<{ ledgerEntryId: string }>;
type DeleteEntryResult = VersionedCommandResult<{ ledgerEntryId: string; deleted: true }>;

function stale<T>(target: VersionedTarget, currentVersion: number): VersionedCommandResult<T> {
  return {
    ok: false,
    reason: "stale",
    sourceDocumentId: target.sourceDocumentId,
    expectedVersion: target.expectedVersion,
    currentVersion,
  };
}

async function listProjectionEntries(
  tx: PostgresTransaction,
  ledgerId: string,
  sourceDocumentId: string,
  revisionId: string
) {
  return tx.query.ledgerEntries.findMany({
    where: and(
      eq(ledgerEntries.ledgerId, ledgerId),
      eq(ledgerEntries.sourceDocumentId, sourceDocumentId),
      eq(ledgerEntries.sourceDocumentRevisionId, revisionId),
      isNull(ledgerEntries.deletedAt)
    ),
    orderBy: (entries, { asc }) => [asc(entries.position), asc(entries.id)],
  });
}

function toProjectionEntry(
  entry: typeof ledgerEntries.$inferSelect
): LedgerProjectionEntryContract {
  return {
    id: entry.id,
    categoryId: entry.categoryId,
    amount: entry.amount,
    currency: entry.currency,
    itemName: entry.itemName,
    description: entry.description,
    createdAt: entry.createdAt.toISOString(),
  };
}

function changed(
  entry: typeof ledgerEntries.$inferSelect,
  input: {
    categoryId?: string | null;
    amount?: string;
    currency?: string | null;
    itemName?: string;
    description?: string | null;
  }
) {
  return (
    (input.categoryId !== undefined && input.categoryId !== entry.categoryId) ||
    (input.amount !== undefined && compareDecimal(input.amount, entry.amount) !== 0) ||
    (input.currency !== undefined && input.currency !== entry.currency) ||
    (input.itemName !== undefined && input.itemName !== entry.itemName) ||
    (input.description !== undefined && input.description !== entry.description)
  );
}

/**
 * Caches the rates an entry in a foreign currency is read at before it is
 * written. Best effort: the entry saves either way.
 */
async function prepareCreate(input: {
  ledgerId: string;
  sourceDocumentId: string;
  currency?: string;
}): Promise<void> {
  const context = await db
    .select({
      mainCurrency: ledgers.mainCurrency,
      effectiveDate: sourceDocuments.effectiveDate,
    })
    .from(sourceDocuments)
    .innerJoin(
      ledgers,
      and(eq(ledgers.id, sourceDocuments.ledgerId), eq(ledgers.id, input.ledgerId))
    )
    .where(
      and(
        eq(sourceDocuments.id, input.sourceDocumentId),
        eq(sourceDocuments.ledgerId, input.ledgerId),
        isNull(sourceDocuments.deletedAt)
      )
    )
    .then((rows) => rows[0]);
  if (context == null) throw new NotFoundError("Source document");
  if (input.currency != null && input.currency !== context.mainCurrency) {
    await ensureExchangeRates([context.effectiveDate]);
  }
}

/**
 * Checks the new amounts keep each entry's direction and, when the currency
 * changes, caches the rates the entries are read at.
 */
async function prepareBatchUpdate(input: {
  ledgerId: string;
  targets: VersionedTarget[];
  ledgerEntryIds: string[];
  amount?: string;
  currency?: string | null;
}): Promise<void> {
  if (input.amount === undefined && input.currency === undefined) return;
  const requestedIds = [...new Set(input.ledgerEntryIds)].sort();
  const targetIds = input.targets.map((target) => target.sourceDocumentId);
  const rows = await db
    .select({
      mainCurrency: ledgers.mainCurrency,
      effectiveDate: sourceDocuments.effectiveDate,
      amount: ledgerEntries.amount,
      currency: ledgerEntries.currency,
    })
    .from(ledgerEntries)
    .innerJoin(
      sourceDocuments,
      and(
        eq(sourceDocuments.id, ledgerEntries.sourceDocumentId),
        eq(sourceDocuments.ledgerId, input.ledgerId),
        eq(sourceDocuments.activeRevisionId, ledgerEntries.sourceDocumentRevisionId),
        inArray(sourceDocuments.id, targetIds),
        isNull(sourceDocuments.deletedAt)
      )
    )
    .innerJoin(
      ledgers,
      and(eq(ledgers.id, sourceDocuments.ledgerId), eq(ledgers.id, input.ledgerId))
    )
    .where(
      and(
        eq(ledgerEntries.ledgerId, input.ledgerId),
        inArray(ledgerEntries.id, requestedIds),
        isNull(ledgerEntries.deletedAt)
      )
    );
  if (rows.length !== requestedIds.length) {
    throw new NotFoundError("Active ledger entry projection");
  }
  for (const entry of rows) {
    const nextCurrency = input.currency !== undefined ? input.currency : entry.currency;
    const effectiveCurrency = nextCurrency ?? entry.mainCurrency;
    assertExpenseAmountDirection(entry.amount, input.amount ?? entry.amount, effectiveCurrency);
  }
  if (input.currency != null && input.currency !== rows[0]?.mainCurrency) {
    await ensureExchangeRates(rows.map((entry) => entry.effectiveDate));
  }
}

function targetMap(targets: readonly VersionedTarget[]) {
  return new Map(targets.map((target) => [target.sourceDocumentId, target] as const));
}

export interface AddLedgerEntryInput {
  ledgerId: string;
  target: VersionedTarget;
  amount: string;
  currency?: string;
  itemName: string;
  categoryId?: string;
  description?: string | null;
}

export interface BatchUpdateLedgerEntriesInput {
  ledgerId: string;
  targets: VersionedTarget[];
  ledgerEntryIds: string[];
  categoryId?: string | null;
  amount?: string;
  currency?: string | null;
  itemName?: string;
  description?: string | null;
}

export async function addLedgerEntry(input: AddLedgerEntryInput): Promise<EntryResult> {
  await prepareCreate({
    ledgerId: input.ledgerId,
    sourceDocumentId: input.target.sourceDocumentId,
    ...(input.currency === undefined ? {} : { currency: input.currency }),
  });
  return db.transaction(async (tx): Promise<EntryResult> => {
    const ledger = await lockLedgerForUpdate(tx, input.ledgerId);
    const document = await lockSourceDocumentForUpdate(
      tx,
      input.ledgerId,
      input.target.sourceDocumentId
    );
    if (document.version !== input.target.expectedVersion) {
      return stale(input.target, document.version);
    }
    if (!hasEditableActiveProjection(document)) {
      throw new NotFoundError("Active source document");
    }
    await assertCategoryOwnership(tx, input.ledgerId, [{ categoryId: input.categoryId }]);
    const entries = await listProjectionEntries(
      tx,
      input.ledgerId,
      document.id,
      document.activeRevisionId
    );
    const ledgerEntryId = crypto.randomUUID();
    const effectiveCurrency = input.currency ?? ledger.mainCurrency;
    await replaceActiveProjectionInTransaction(tx, {
      document,
      previousEntries: entries,
      ledgerId: input.ledgerId,
      sourceDocumentId: document.id,
      expectedActiveRevisionId: document.activeRevisionId,
      expectedStateVersion: input.target.expectedVersion,

      entries: [
        ...entries.map(toProjectionEntry),
        {
          id: ledgerEntryId,
          categoryId: input.categoryId ?? null,
          amount: roundToCurrency(input.amount, effectiveCurrency),
          currency: effectiveCurrency,
          itemName: input.itemName,
          description: input.description ?? null,
        },
      ],
    });
    return {
      ok: true,
      sourceDocumentId: document.id,
      version: input.target.expectedVersion + 1,
      data: { ledgerEntryId },
    };
  });
}

export async function deleteLedgerEntry(input: {
  ledgerId: string;
  target: VersionedTarget;
  ledgerEntryId: string;
}): Promise<DeleteEntryResult> {
  return db.transaction(async (tx): Promise<DeleteEntryResult> => {
    await lockLedgerForUpdate(tx, input.ledgerId);
    const document = await lockSourceDocumentForUpdate(
      tx,
      input.ledgerId,
      input.target.sourceDocumentId
    );
    if (document.version !== input.target.expectedVersion) {
      return stale(input.target, document.version);
    }
    if (!hasEditableActiveProjection(document)) {
      throw new NotFoundError("Active source document");
    }
    const entries = await listProjectionEntries(
      tx,
      input.ledgerId,
      document.id,
      document.activeRevisionId
    );
    if (!entries.some((entry) => entry.id === input.ledgerEntryId)) {
      throw new NotFoundError("Active ledger entry projection");
    }
    await replaceActiveProjectionInTransaction(tx, {
      document,
      previousEntries: entries,
      ledgerId: input.ledgerId,
      sourceDocumentId: document.id,
      expectedActiveRevisionId: document.activeRevisionId,
      expectedStateVersion: input.target.expectedVersion,

      entries: entries.filter((entry) => entry.id !== input.ledgerEntryId).map(toProjectionEntry),
    });
    return {
      ok: true,
      sourceDocumentId: document.id,
      version: input.target.expectedVersion + 1,
      data: { ledgerEntryId: input.ledgerEntryId, deleted: true },
    };
  });
}

export async function batchUpdateLedgerEntries(
  input: BatchUpdateLedgerEntriesInput
): Promise<AtomicBatchCommandResult<{ ledgerEntryIds: string[]; affectedCount: number }>> {
  await prepareBatchUpdate(input);
  return db.transaction(async (tx) => {
    const ledger = await lockLedgerForUpdate(tx, input.ledgerId);
    const targets = input.targets;
    const expectedByDocument = targetMap(targets);
    const documents = await lockSourceDocumentsForUpdate(
      tx,
      input.ledgerId,
      targets.map((target) => target.sourceDocumentId)
    );
    const staleTargets = documents.flatMap((document) => {
      const target = expectedByDocument.get(document.id)!;
      return document.version === target.expectedVersion
        ? []
        : [{ ...target, currentVersion: document.version }];
    });
    if (staleTargets.length > 0) {
      return { ok: false as const, reason: "stale" as const, staleTargets };
    }
    if (documents.some((document) => !hasEditableActiveProjection(document))) {
      throw new NotFoundError("Active source document");
    }
    await assertCategoryOwnership(tx, input.ledgerId, [{ categoryId: input.categoryId }]);
    const requestedIds = [...new Set(input.ledgerEntryIds)].sort();
    const requested = new Set(requestedIds);
    const activeEntries = await tx
      .select(getTableColumns(ledgerEntries))
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
      .where(
        and(
          eq(ledgerEntries.ledgerId, input.ledgerId),
          inArray(
            ledgerEntries.sourceDocumentId,
            documents.map((document) => document.id)
          ),
          isNull(ledgerEntries.deletedAt)
        )
      )
      .orderBy(ledgerEntries.sourceDocumentId, ledgerEntries.position, ledgerEntries.id);
    const entriesByDocument = new Map<string, typeof activeEntries>();
    for (const entry of activeEntries) {
      const group = entriesByDocument.get(entry.sourceDocumentId!) ?? [];
      group.push(entry);
      entriesByDocument.set(entry.sourceDocumentId!, group);
    }
    const selectedById = new Map(
      activeEntries
        .filter((entry) => requested.has(entry.id))
        .map((entry) => [entry.id, entry] as const)
    );
    if (selectedById.size !== requestedIds.length) {
      throw new NotFoundError("Active ledger entry projection");
    }
    const selectedDocumentIds = new Set(
      [...selectedById.values()].map((entry) => entry.sourceDocumentId!)
    );
    if (
      selectedDocumentIds.size !== targets.length ||
      targets.some((target) => !selectedDocumentIds.has(target.sourceDocumentId))
    ) {
      throw new NotFoundError("Source document target");
    }

    const changedIds = new Set(
      [...selectedById.values()].filter((entry) => changed(entry, input)).map((entry) => entry.id)
    );
    if (changedIds.size === 0) {
      return {
        ok: true as const,
        versions: documents.map((document) => ({
          sourceDocumentId: document.id,
          version: document.version,
        })),
        data: { ledgerEntryIds: requestedIds, affectedCount: 0 },
      };
    }

    const nextById = new Map<string, LedgerProjectionEntryContract>();
    for (const entry of selectedById.values()) {
      if (!changedIds.has(entry.id)) continue;
      const nextCurrency = input.currency !== undefined ? input.currency : entry.currency;
      const effectiveCurrency = nextCurrency ?? ledger.mainCurrency;
      const nextAmount = input.amount ?? entry.amount;
      const amountChanged = input.amount !== undefined || input.currency !== undefined;
      nextById.set(entry.id, {
        ...toProjectionEntry(entry),
        categoryId: input.categoryId !== undefined ? input.categoryId : entry.categoryId,
        amount: amountChanged ? roundToCurrency(nextAmount, effectiveCurrency) : entry.amount,
        currency: input.currency !== undefined ? effectiveCurrency : entry.currency,
        itemName: input.itemName !== undefined ? input.itemName : entry.itemName,
        description: input.description !== undefined ? input.description : entry.description,
      });
    }

    const changedDocumentIds = new Set(
      [...selectedById.values()]
        .filter((entry) => changedIds.has(entry.id))
        .map((entry) => entry.sourceDocumentId!)
    );
    const changedDocuments = documents.filter((document) => changedDocumentIds.has(document.id));
    for (const document of changedDocuments) {
      const entries = entriesByDocument.get(document.id)!;
      await replaceActiveProjectionInTransaction(tx, {
        document,
        previousEntries: entries,
        ledgerId: input.ledgerId,
        sourceDocumentId: document.id,
        expectedActiveRevisionId: document.activeRevisionId!,
        expectedStateVersion: document.version,

        entries: entries.map((entry) => nextById.get(entry.id) ?? toProjectionEntry(entry)),
      });
    }
    return {
      ok: true as const,
      versions: documents.map((document) => ({
        sourceDocumentId: document.id,
        version: document.version + (changedDocumentIds.has(document.id) ? 1 : 0),
      })),
      data: { ledgerEntryIds: requestedIds, affectedCount: changedIds.size },
    };
  });
}

export async function batchDeleteLedgerEntries(input: {
  ledgerId: string;
  targets: VersionedTarget[];
  ledgerEntryIds: string[];
}): Promise<PartialBatchCommandResult> {
  const requestedIds = [...new Set(input.ledgerEntryIds)].sort();
  const result: import("@/modules/source-document/contracts").PartialBatchCommandResult = {
    succeeded: [],
    stale: [],
    failed: [],
  };
  const ownership = await db
    .select({
      id: ledgerEntries.id,
      sourceDocumentId: ledgerEntries.sourceDocumentId,
      sourceDocumentRevisionId: ledgerEntries.sourceDocumentRevisionId,
    })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.ledgerId, input.ledgerId),
        inArray(ledgerEntries.id, requestedIds),
        isNull(ledgerEntries.deletedAt)
      )
    );
  const ownershipById = new Map(ownership.map((row) => [row.id, row] as const));
  const groups = new Map<string, string[]>();
  for (const id of requestedIds) {
    const row = ownershipById.get(id);
    if (row?.sourceDocumentId == null) {
      result.failed.push({ id, code: "NOT_FOUND" });
      continue;
    }
    const ids = groups.get(row.sourceDocumentId) ?? [];
    ids.push(id);
    groups.set(row.sourceDocumentId, ids);
  }
  const targets = targetMap(input.targets);
  for (const [sourceDocumentId, entryIds] of [...groups].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const target = targets.get(sourceDocumentId);
    if (target == null) {
      result.failed.push(...entryIds.map((id) => ({ id, code: "MISSING_TARGET" })));
      continue;
    }
    try {
      const groupResult = await db.transaction(async (tx) => {
        await lockLedgerForUpdate(tx, input.ledgerId);
        const document = await lockSourceDocumentForUpdate(tx, input.ledgerId, sourceDocumentId);
        if (document.version !== target.expectedVersion) return document.version;
        if (!hasEditableActiveProjection(document)) {
          throw new NotFoundError("Active source document");
        }
        const entries = await listProjectionEntries(
          tx,
          input.ledgerId,
          sourceDocumentId,
          document.activeRevisionId
        );
        const selected = new Set(entryIds);
        if (entryIds.some((id) => !entries.some((entry) => entry.id === id))) {
          throw new NotFoundError("Active ledger entry projection");
        }
        await replaceActiveProjectionInTransaction(tx, {
          document,
          previousEntries: entries,
          ledgerId: input.ledgerId,
          sourceDocumentId,
          expectedActiveRevisionId: document.activeRevisionId,
          expectedStateVersion: target.expectedVersion,

          entries: entries.filter((entry) => !selected.has(entry.id)).map(toProjectionEntry),
        });
        return null;
      });
      if (groupResult != null) {
        result.stale.push(
          ...entryIds.map((id) => ({
            id,
            sourceDocumentId,
            expectedVersion: target.expectedVersion,
            currentVersion: groupResult,
          }))
        );
      } else {
        result.succeeded.push(
          ...entryIds.map((id) => ({
            id,
            sourceDocumentId,
            version: target.expectedVersion + 1,
          }))
        );
      }
    } catch (error) {
      result.failed.push(
        ...entryIds.map((id) => ({
          id,
          code: error instanceof NotFoundError ? error.code : "INTERNAL",
        }))
      );
    }
  }
  return result;
}
