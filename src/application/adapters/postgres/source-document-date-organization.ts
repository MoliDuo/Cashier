import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { compare, round } from "@/lib/money/decimal";
import { roundToCurrency } from "@/lib/money/currency-precision";
import { ledgerEntries, ledgers, sourceDocuments, sourceDocumentRevisions } from "@/persistence";
import type {
  ApplyDateOrganizationInput,
  ApplyDateOrganizationResultDto,
  DismissDateOrganizationInput,
  VersionedCommandResult,
} from "@/modules/source-document/contracts";
import { postgresFxRateBook } from "./exchange-rate";
import { lockLedgerForUpdate, lockSourceDocumentForUpdate } from "./transaction-locks";
import { assertSourceDocumentNotProcessing } from "./source-document-write-guards";
import { copyRevisionFiles, createManualRevision } from "./ledger-projections";
import { getSourceDocumentInTransaction } from "./source-document-reads/list";
import { getSourceDocumentLightForLedger } from "@/modules/source-document/application/queries/get-source-document-light";

function normalizeCurrency(value: string | null) {
  return value == null || value === "" ? "CNY" : value;
}

export async function dismissDateOrganization(
  input: DismissDateOrganizationInput & { ledgerId: string }
): Promise<VersionedCommandResult<{ dismissed: true }>> {
  const result = await db
    .update(sourceDocuments)
    .set({ dateOrganizationSuggestion: null, version: sql`${sourceDocuments.version} + 1` })
    .where(
      and(
        eq(sourceDocuments.ledgerId, input.ledgerId),
        eq(sourceDocuments.id, input.sourceDocumentId),
        eq(sourceDocuments.version, input.expectedVersion),
        sql`${sourceDocuments.dateOrganizationSuggestion}->>'id' = ${input.suggestionId}`,
        isNull(sourceDocuments.deletedAt)
      )
    )
    .returning({ version: sourceDocuments.version });
  if (result[0] == null) {
    const current = await db.query.sourceDocuments.findFirst({
      where: and(
        eq(sourceDocuments.ledgerId, input.ledgerId),
        eq(sourceDocuments.id, input.sourceDocumentId),
        isNull(sourceDocuments.deletedAt)
      ),
      columns: { version: true },
    });
    if (current == null) throw new NotFoundError("Source document");
    return {
      ok: false,
      reason: "stale",
      sourceDocumentId: input.sourceDocumentId,
      expectedVersion: input.expectedVersion,
      currentVersion: current.version,
    };
  }
  return {
    ok: true,
    sourceDocumentId: input.sourceDocumentId,
    version: result[0].version,
    data: { dismissed: true },
  };
}

export async function applyDateOrganization(
  input: ApplyDateOrganizationInput & { ledgerId: string }
): Promise<VersionedCommandResult<ApplyDateOrganizationResultDto>> {
  const [ledger, document] = await Promise.all([
    db.query.ledgers.findFirst({
      where: and(eq(ledgers.id, input.ledgerId), isNull(ledgers.deletedAt)),
      columns: { mainCurrency: true },
    }),
    db.query.sourceDocuments.findFirst({
      where: and(
        eq(sourceDocuments.ledgerId, input.ledgerId),
        eq(sourceDocuments.id, input.sourceDocumentId),
        isNull(sourceDocuments.deletedAt)
      ),
    }),
  ]);
  if (ledger == null || document == null) throw new NotFoundError("Source document");
  if (document.version !== input.expectedVersion)
    return {
      ok: false,
      reason: "stale",
      sourceDocumentId: input.sourceDocumentId,
      expectedVersion: input.expectedVersion,
      currentVersion: document.version,
    };
  if (
    document.activeRevisionId == null ||
    document.dateOrganizationSuggestion?.id !== input.suggestionId
  )
    throw new ConflictError("Date organization suggestion is no longer current");
  const entries = await db.query.ledgerEntries.findMany({
    where: and(
      eq(ledgerEntries.ledgerId, input.ledgerId),
      eq(ledgerEntries.sourceDocumentId, input.sourceDocumentId),
      eq(ledgerEntries.sourceDocumentRevisionId, document.activeRevisionId),
      isNull(ledgerEntries.deletedAt)
    ),
    orderBy: [asc(ledgerEntries.position), asc(ledgerEntries.id)],
  });
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  for (const item of document.dateOrganizationSuggestion.items) {
    const current = entriesById.get(item.ledgerEntryId);
    if (
      current != null &&
      (current.itemName !== item.snapshot.itemName ||
        compare(current.amount, item.snapshot.amount) !== 0 ||
        normalizeCurrency(current.currency) !== item.snapshot.currency)
    )
      throw new ConflictError("A suggested entry changed before date organization");
  }
  const appliedIds = new Set(input.appliedGroupIds);
  const appliedGroups = input.groups.filter((group) => appliedIds.has(group.id));
  const requestedIds = appliedGroups.flatMap((group) => group.ledgerEntryIds);
  if (requestedIds.some((id) => !entriesById.has(id)))
    throw new ConflictError("Date organization contains an unknown entry");
  const assigned = new Set(requestedIds);
  let originalGroup =
    appliedGroups.find((group) => group.entryDate === document.documentDate) ?? null;
  if (assigned.size === entries.length && originalGroup == null) {
    originalGroup =
      [...appliedGroups]
        .filter((group) => group.entryDate != null)
        .sort((a, b) => b.entryDate!.localeCompare(a.entryDate!))[0] ?? null;
  }
  const destinationGroups = appliedGroups.filter(
    (group) => group.entryDate != null && group !== originalGroup
  );
  const conversionByEntry = new Map<string, { convertedAmount: string; exchangeRate: string }>();
  for (const group of appliedGroups) {
    if (group.entryDate == null || group.entryDate === document.documentDate) continue;
    const conversions = await postgresFxRateBook.convertBatch(
      group.ledgerEntryIds.map((id) => {
        const entry = entriesById.get(id)!;
        return {
          amount: entry.amount,
          from: normalizeCurrency(entry.currency),
          date: group.entryDate!,
        };
      }),
      ledger.mainCurrency
    );
    group.ledgerEntryIds.forEach((id, index) => conversionByEntry.set(id, conversions[index]!));
  }
  const createdIds = destinationGroups.map(() => crypto.randomUUID());
  const outcome = await db.transaction(async (tx) => {
    const lockedLedger = await lockLedgerForUpdate(tx, input.ledgerId);
    const lockedDocument = await lockSourceDocumentForUpdate(
      tx,
      input.ledgerId,
      input.sourceDocumentId
    );
    if (lockedDocument.version !== input.expectedVersion)
      return { staleVersion: lockedDocument.version } as const;
    if (
      lockedLedger.mainCurrency !== ledger.mainCurrency ||
      lockedDocument.activeRevisionId !== document.activeRevisionId ||
      lockedDocument.dateOrganizationSuggestion?.id !== input.suggestionId
    )
      throw new ConflictError("Source document changed before date organization");
    await assertSourceDocumentNotProcessing(tx, lockedDocument);
    const activeRevision = await tx.query.sourceDocumentRevisions.findFirst({
      where: and(
        eq(sourceDocumentRevisions.ledgerId, input.ledgerId),
        eq(sourceDocumentRevisions.id, lockedDocument.activeRevisionId!)
      ),
    });
    if (activeRevision == null) throw new ConflictError("Active revision is missing");
    const currentIds = await tx.query.ledgerEntries.findMany({
      where: and(
        eq(ledgerEntries.ledgerId, input.ledgerId),
        eq(ledgerEntries.sourceDocumentId, input.sourceDocumentId),
        eq(ledgerEntries.sourceDocumentRevisionId, lockedDocument.activeRevisionId!),
        isNull(ledgerEntries.deletedAt)
      ),
      columns: { id: true },
    });
    if (
      currentIds.length !== entries.length ||
      currentIds.some((entry) => !entriesById.has(entry.id))
    )
      throw new ConflictError("Source document entries changed before date organization");
    const sourceRevision = await createManualRevision(tx, {
      ledgerId: input.ledgerId,
      sourceDocumentId: input.sourceDocumentId,
      origin: "manual_edit",
      inputText: activeRevision.inputText,
    });
    await copyRevisionFiles(tx, {
      ledgerId: input.ledgerId,
      fromRevisionId: activeRevision.id,
      toRevisionId: sourceRevision.id,
    });
    const destinationByEntry = new Map<
      string,
      { documentId: string; revisionId: string; entryDate: string }
    >();
    for (const [index, group] of destinationGroups.entries()) {
      const id = createdIds[index]!;
      await tx.insert(sourceDocuments).values({
        id,
        ledgerId: input.ledgerId,
        attributedUserId: lockedDocument.attributedUserId,
        createdByUserId: lockedDocument.createdByUserId,
        title: lockedDocument.title ?? activeRevision.title,
        version: 1,
        documentDate: group.entryDate,
      });
      const revision = await createManualRevision(tx, {
        ledgerId: input.ledgerId,
        sourceDocumentId: id,
        origin: "manual_entry",
        inputText: activeRevision.inputText,
      });
      await copyRevisionFiles(tx, {
        ledgerId: input.ledgerId,
        fromRevisionId: activeRevision.id,
        toRevisionId: revision.id,
      });
      for (const entryId of group.ledgerEntryIds)
        destinationByEntry.set(entryId, {
          documentId: id,
          revisionId: revision.id,
          entryDate: group.entryDate!,
        });
      await tx
        .update(sourceDocuments)
        .set({ activeRevisionId: revision.id, latestSubmissionRevisionId: null })
        .where(eq(sourceDocuments.id, id));
    }
    const positions = new Map<string, number>();
    for (const entry of entries) {
      const destination = destinationByEntry.get(entry.id);
      const docId = destination?.documentId ?? input.sourceDocumentId;
      const position = positions.get(docId) ?? 0;
      positions.set(docId, position + 1);
      const conversion = conversionByEntry.get(entry.id);
      await tx
        .update(ledgerEntries)
        .set({
          sourceDocumentId: docId,
          sourceDocumentRevisionId: destination?.revisionId ?? sourceRevision.id,
          position,
          convertedAmount:
            conversion == null
              ? entry.convertedAmount
              : roundToCurrency(conversion.convertedAmount, lockedLedger.mainCurrency),
          exchangeRate:
            conversion == null ? entry.exchangeRate : round(conversion.exchangeRate, 12),
          updatedAt: new Date(),
        })
        .where(and(eq(ledgerEntries.id, entry.id), eq(ledgerEntries.ledgerId, input.ledgerId)));
    }
    await tx.insert(ledgerEntries).values(
      entries.map((entry) => ({
        ...entry,
        id: crypto.randomUUID(),
        deletedAt: new Date(),
        updatedAt: new Date(),
      }))
    );
    const remainingItems = lockedDocument.dateOrganizationSuggestion.items.filter(
      (item) => !assigned.has(item.ledgerEntryId)
    );
    const remainingSuggestion =
      remainingItems.length === 0
        ? null
        : { ...lockedDocument.dateOrganizationSuggestion, items: remainingItems };
    await tx
      .update(sourceDocuments)
      .set({
        activeRevisionId: sourceRevision.id,
        version: sql`${sourceDocuments.version} + 1`,
        documentDate: originalGroup?.entryDate ?? lockedDocument.documentDate,
        dateOrganizationSuggestion: remainingSuggestion,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(sourceDocuments.id, input.sourceDocumentId),
          eq(sourceDocuments.version, input.expectedVersion)
        )
      );
    const sourceDocument = await getSourceDocumentLightForLedger(
      input.ledgerId,
      input.sourceDocumentId,
      { get: (ledgerId, id) => getSourceDocumentInTransaction(tx, ledgerId, id) }
    );
    if (sourceDocument == null) throw new NotFoundError("Source document");
    return { sourceDocument } as const;
  });
  if ("staleVersion" in outcome)
    return {
      ok: false,
      reason: "stale",
      sourceDocumentId: input.sourceDocumentId,
      expectedVersion: input.expectedVersion,
      currentVersion: outcome.staleVersion,
    };
  return {
    ok: true,
    sourceDocumentId: input.sourceDocumentId,
    version: input.expectedVersion + 1,
    data: { sourceDocument: outcome.sourceDocument, createdSourceDocumentIds: createdIds },
  };
}
