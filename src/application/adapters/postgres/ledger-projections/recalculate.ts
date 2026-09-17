import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { LedgerProjectionPort } from "@/application/contracts";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { compare as compareDecimal } from "@/lib/money/decimal";
import { ledgerEntries, sourceDocumentRevisions, sourceDocuments } from "@/persistence";
import {
  lockLedgerForUpdate,
  lockSourceDocumentForUpdate,
  lockSourceDocumentsForUpdate,
} from "../transaction-locks";
import { completeProcessingLeaseInTransaction } from "../processing-terminal";
import { softDeleteSourceDocumentInTransaction } from "../source-document-delete";

import { LedgerMainCurrencyChangedError, activeDocumentWhere, replaceProjection } from "./shared";
import { createCompletedProjectionInTransaction } from "./manual-entries";

export const postgresLedgerProjectionAdapter: LedgerProjectionPort = {
  async activateRevision(input) {
    return db.transaction(async (tx) => {
      // Lock the ledger row to serialise with concurrent main-currency changes.
      // The lock prevents a main-currency change from interleaving with result activation.
      const ledger = await lockLedgerForUpdate(tx, input.ledgerId);
      if (ledger.mainCurrency !== input.expectedMainCurrency) {
        throw new LedgerMainCurrencyChangedError();
      }

      // Also lock the source document row to serialise with concurrent soft-delete.
      // Lock order: ledger → source document (prevents deadlocks).
      let document: typeof sourceDocuments.$inferSelect;
      try {
        document = await lockSourceDocumentForUpdate(tx, input.ledgerId, input.sourceDocumentId);
      } catch (error) {
        if (error instanceof NotFoundError) return false;
        throw error;
      }
      if (document.latestSubmissionRevisionId !== input.revisionId) return false;
      const revision = await tx
        .select()
        .from(sourceDocumentRevisions)
        .where(
          and(
            eq(sourceDocumentRevisions.ledgerId, input.ledgerId),
            eq(sourceDocumentRevisions.sourceDocumentId, input.sourceDocumentId),
            eq(sourceDocumentRevisions.id, input.revisionId)
          )
        )
        .for("update")
        .then((rows) => rows[0]);
      if (revision == null || revision.processingStatus !== "processing") {
        return false;
      }
      if (!(await completeProcessingLeaseInTransaction(tx, input.lease, "completed"))) {
        return false;
      }

      await replaceProjection(tx, input);
      const now = new Date();
      await tx
        .update(sourceDocumentRevisions)
        .set({
          title: input.title ?? null,
          processingStatus: "completed",
          finishedAt: now,
          failureKind: null,
          failureMessage: null,
          failureCode: null,
        })
        .where(eq(sourceDocumentRevisions.id, input.revisionId));
      await tx
        .update(sourceDocuments)
        .set({
          activeRevisionId: input.revisionId,
          version: sql`${sourceDocuments.version} + 1`,
          documentDate: revision.inputDocumentDate,
          ...(input.title == null || input.title === "" ? {} : { title: input.title }),
          dateOrganizationSuggestion: input.dateOrganizationSuggestion ?? null,
          updatedAt: now,
        })
        .where(activeDocumentWhere(input.ledgerId, input.sourceDocumentId));
      return true;
    });
  },

  async createManual(input) {
    return db.transaction(async (tx) => {
      // Lock the ledger row to serialise with concurrent main-currency changes.
      // This is the first-active-projection path; the lock prevents a settings
      // main-currency change from interleaving with entry creation.
      const ledger = await lockLedgerForUpdate(tx, input.ledgerId);
      if (ledger.mainCurrency !== input.expectedMainCurrency) {
        throw new ConflictError("Ledger currency changed before quick entry commit");
      }

      const sourceDocumentId = input.sourceDocumentId ?? crypto.randomUUID();
      const revisionId = await createCompletedProjectionInTransaction(tx, {
        ledgerId: input.ledgerId,
        attributedUserId: input.attributedUserId,
        createdByUserId: input.createdByUserId,
        sourceDocumentId,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.entryDate !== undefined ? { entryDate: input.entryDate } : {}),
        ...(input.inputText !== undefined ? { inputText: input.inputText } : {}),
        entries: input.entries,
      });
      return { sourceDocumentId, revisionId };
    });
  },

  async recalculate(input) {
    if (input.updates.length === 0) return 0;
    return db.transaction(async (tx) => {
      await lockLedgerForUpdate(tx, input.ledgerId);
      const uniqueIds = new Set(input.updates.map((update) => update.ledgerEntryId));
      if (uniqueIds.size !== input.updates.length) {
        throw new ValidationError("A ledger entry may only be recalculated once per transaction");
      }
      const requestedIds = [...uniqueIds];
      const current = await tx
        .select({
          id: ledgerEntries.id,
          sourceDocumentId: ledgerEntries.sourceDocumentId,
          convertedAmount: ledgerEntries.convertedAmount,
          exchangeRate: ledgerEntries.exchangeRate,
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
        .where(
          and(
            eq(ledgerEntries.ledgerId, input.ledgerId),
            inArray(ledgerEntries.id, requestedIds),
            isNull(ledgerEntries.deletedAt)
          )
        );
      if (current.length !== input.updates.length) {
        throw new NotFoundError("Active ledger entry projection");
      }
      const currentById = new Map(current.map((entry) => [entry.id, entry] as const));
      const changedUpdates = input.updates.filter((update) => {
        const entry = currentById.get(update.ledgerEntryId)!;
        return (
          (entry.convertedAmount == null) !== (update.convertedAmount == null) ||
          (entry.convertedAmount != null &&
            update.convertedAmount != null &&
            compareDecimal(entry.convertedAmount, update.convertedAmount) !== 0) ||
          (entry.exchangeRate == null) !== (update.exchangeRate == null) ||
          (entry.exchangeRate != null &&
            update.exchangeRate != null &&
            compareDecimal(entry.exchangeRate, update.exchangeRate) !== 0)
        );
      });
      if (changedUpdates.length === 0) return 0;
      const documentIds = [
        ...new Set(
          changedUpdates.map((update) => currentById.get(update.ledgerEntryId)!.sourceDocumentId!)
        ),
      ].sort();
      await lockSourceDocumentsForUpdate(tx, input.ledgerId, documentIds);
      const changes = JSON.stringify(
        changedUpdates.map((update) => ({
          id: update.ledgerEntryId,
          converted_amount: update.convertedAmount,
          exchange_rate: update.exchangeRate,
        }))
      );
      const now = new Date();
      const updated = await tx.execute(sql`
        WITH changes AS (
          SELECT * FROM jsonb_to_recordset(${changes}::jsonb) AS value(
            id uuid,
            converted_amount numeric,
            exchange_rate numeric
          )
        )
        UPDATE ledger_entries AS entry
        SET converted_amount = changes.converted_amount,
            exchange_rate = changes.exchange_rate,
            updated_at = ${now}
        FROM changes, source_documents AS document
        WHERE entry.id = changes.id
          AND entry.ledger_id = ${input.ledgerId}
          AND entry.deleted_at IS NULL
          AND document.id = entry.source_document_id
          AND document.ledger_id = entry.ledger_id
          AND document.active_revision_id = entry.source_document_revision_id
          AND document.deleted_at IS NULL
        RETURNING entry.id
      `);
      if (updated.rows.length !== changedUpdates.length) {
        throw new NotFoundError("Active ledger entry projection");
      }
      await tx
        .update(sourceDocuments)
        .set({
          version: sql`${sourceDocuments.version} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(sourceDocuments.ledgerId, input.ledgerId),
            inArray(sourceDocuments.id, documentIds),
            isNull(sourceDocuments.deletedAt)
          )
        );
      return changedUpdates.length;
    });
  },

  async softDelete(ledgerId, sourceDocumentId) {
    return db.transaction((tx) =>
      softDeleteSourceDocumentInTransaction(tx, ledgerId, sourceDocumentId)
    );
  },
};
