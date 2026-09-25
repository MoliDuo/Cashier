import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { ledgerEntries, ledgers, sourceDocumentRevisions, sourceDocuments } from "@/persistence";
import type { SplitSourceDocumentResultDto } from "@/modules/source-document/contracts";
import { ensureExchangeRates } from "@/modules/currency/server/exchange-rates";
import { getSourceDocumentInTransaction } from "./reads/list";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { copyRevisionFiles, createManualRevision } from "./projections/manual-entries";
import { lockLedgerForUpdate, lockSourceDocumentForUpdate } from "@/lib/db/transaction-locks";
import { assertSourceDocumentNotProcessing } from "./write-guards";

function effectiveTitle(documentTitle: string | null, revisionTitle: string | null): string | null {
  return documentTitle?.trim() || revisionTitle?.trim() || null;
}

export async function splitSourceDocumentAtomically(input: {
  ledgerId: string;
  sourceDocumentId: string;
  ledgerEntryIds: string[];
  entryDate: string;
}): Promise<SplitSourceDocumentResultDto> {
  const startedAt = performance.now();
  const requestId = crypto.randomUUID();
  const [ledger, document] = await Promise.all([
    db.query.ledgers.findFirst({
      where: eq(ledgers.id, input.ledgerId),
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
  if (document.activeRevisionId == null) {
    throw new ConflictError("Source document cannot be split in its current state");
  }
  const initialEntries = await db.query.ledgerEntries.findMany({
    where: and(
      eq(ledgerEntries.ledgerId, input.ledgerId),
      eq(ledgerEntries.sourceDocumentId, input.sourceDocumentId),
      eq(ledgerEntries.sourceDocumentRevisionId, document.activeRevisionId),
      isNull(ledgerEntries.deletedAt)
    ),
    orderBy: [asc(ledgerEntries.position), asc(ledgerEntries.id)],
  });
  const selectedIds = new Set(input.ledgerEntryIds);
  const movedEntries = initialEntries.filter((entry) => selectedIds.has(entry.id));
  if (movedEntries.length !== selectedIds.size) {
    throw new ConflictError("Selected entries are not in the active source document revision");
  }
  if (movedEntries.length >= initialEntries.length) {
    throw new ConflictError("The source document must retain at least one entry");
  }
  const preparedAt = performance.now();
  if (movedEntries.some((entry) => entry.currency !== ledger.mainCurrency)) {
    await ensureExchangeRates([input.entryDate]);
  }
  const movedIds = new Set(movedEntries.map((entry) => entry.id));
  const convertedAt = performance.now();

  const splitSourceDocumentId = crypto.randomUUID();
  const outcome = await db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx, input.ledgerId);
    const lockedDocument = await lockSourceDocumentForUpdate(
      tx,
      input.ledgerId,
      input.sourceDocumentId
    );
    if (lockedDocument.activeRevisionId == null) {
      throw new ConflictError("Source document changed before the split");
    }
    await assertSourceDocumentNotProcessing(tx, lockedDocument);
    const activeRevision = await tx.query.sourceDocumentRevisions.findFirst({
      where: and(
        eq(sourceDocumentRevisions.ledgerId, input.ledgerId),
        eq(sourceDocumentRevisions.sourceDocumentId, input.sourceDocumentId),
        eq(sourceDocumentRevisions.id, lockedDocument.activeRevisionId),
        or(
          eq(sourceDocumentRevisions.processingStatus, "completed"),
          isNull(sourceDocumentRevisions.processingStatus)
        )
      ),
    });
    if (activeRevision == null) throw new ConflictError("Active revision is not completed");
    const currentEntries = await tx.query.ledgerEntries.findMany({
      where: and(
        eq(ledgerEntries.ledgerId, input.ledgerId),
        eq(ledgerEntries.sourceDocumentId, input.sourceDocumentId),
        eq(ledgerEntries.sourceDocumentRevisionId, lockedDocument.activeRevisionId),
        isNull(ledgerEntries.deletedAt)
      ),
      orderBy: [asc(ledgerEntries.position), asc(ledgerEntries.id)],
    });
    // The split moves the selected entries as they are now, so an edit to any
    // entry since the selection was made carries over; it only needs every
    // selected entry still here and at least one left behind.
    const currentIds = new Set(currentEntries.map((entry) => entry.id));
    if ([...movedIds].some((id) => !currentIds.has(id))) {
      throw new ConflictError("Selected entries are not in the active source document revision");
    }
    if (movedIds.size >= currentEntries.length) {
      throw new ConflictError("The source document must retain at least one entry");
    }

    await tx.insert(sourceDocuments).values({
      id: splitSourceDocumentId,
      ledgerId: input.ledgerId,
      bookId: lockedDocument.bookId,
      title: effectiveTitle(lockedDocument.title, activeRevision.title),

      version: 1,
      documentDate: input.entryDate,
    });
    const splitRevision = await createManualRevision(tx, {
      ledgerId: input.ledgerId,
      sourceDocumentId: splitSourceDocumentId,
      inputText: activeRevision.inputText,
    });
    await copyRevisionFiles(tx, {
      ledgerId: input.ledgerId,
      fromRevisionId: activeRevision.id,
      toRevisionId: splitRevision.id,
    });

    // Free the active positions before assigning contiguous positions in the same revision.
    const positionOffset = Math.max(0, ...currentEntries.map((entry) => entry.position + 1));
    await tx
      .update(ledgerEntries)
      .set({ position: sql`${ledgerEntries.position} + ${positionOffset}` })
      .where(
        and(
          eq(ledgerEntries.ledgerId, input.ledgerId),
          eq(ledgerEntries.sourceDocumentId, input.sourceDocumentId),
          eq(ledgerEntries.sourceDocumentRevisionId, activeRevision.id),
          isNull(ledgerEntries.deletedAt)
        )
      );

    const now = new Date();
    let splitPosition = 0;
    let sourcePosition = 0;
    const entryPatches = currentEntries.map((entry) => {
      const isMoved = movedIds.has(entry.id);
      return {
        id: entry.id,
        source_document_id: isMoved ? splitSourceDocumentId : input.sourceDocumentId,
        source_document_revision_id: isMoved ? splitRevision.id : activeRevision.id,
        position: isMoved ? splitPosition++ : sourcePosition++,
      };
    });
    const updatedEntries = await tx.execute(sql`
      WITH patches AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(entryPatches)}::jsonb) AS value(
          id uuid,
          source_document_id uuid,
          source_document_revision_id uuid,
          position integer
        )
      )
      UPDATE ledger_entries AS entry
      SET source_document_id = patches.source_document_id,
          source_document_revision_id = patches.source_document_revision_id,
          position = patches.position,
          updated_at = ${now}
      FROM patches
      WHERE entry.id = patches.id
        AND entry.ledger_id = ${input.ledgerId}
        AND entry.deleted_at IS NULL
      RETURNING entry.id
    `);
    if (updatedEntries.rows.length !== currentEntries.length) {
      throw new ConflictError("Source document entries changed during the split");
    }
    await tx
      .update(sourceDocuments)
      .set({
        dateOrganizationSuggestion: null,
        version: sql`${sourceDocuments.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(sourceDocuments.ledgerId, input.ledgerId),
          eq(sourceDocuments.id, input.sourceDocumentId)
        )
      );
    await tx
      .update(sourceDocuments)
      .set({ activeRevisionId: splitRevision.id, latestSubmissionRevisionId: null, updatedAt: now })
      .where(
        and(
          eq(sourceDocuments.ledgerId, input.ledgerId),
          eq(sourceDocuments.id, splitSourceDocumentId)
        )
      );
    const sourceDocument = await getSourceDocumentInTransaction(
      tx,
      input.ledgerId,
      input.sourceDocumentId
    );
    if (sourceDocument == null) throw new NotFoundError("Source document");
    return { movedEntryCount: movedEntries.length, sourceDocument } as const;
  });
  logger.debug(
    {
      requestId,
      sourceDocumentSubject: logIdentifier("source-document", input.sourceDocumentId),
      entryCount: initialEntries.length,
      movedEntryCount: movedEntries.length,
      preparationMs: Math.round(preparedAt - startedAt),
      conversionMs: Math.round(convertedAt - preparedAt),
      transactionMs: Math.round(performance.now() - convertedAt),
    },
    "Source document split timing"
  );

  return {
    sourceDocument: outcome.sourceDocument,
    splitSourceDocumentId,
    splitVersion: 1,
    movedEntryCount: outcome.movedEntryCount,
  };
}
