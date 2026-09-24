import { and, eq, sql } from "drizzle-orm";
import type { LedgerProjectionPort } from "@/application/contracts";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { sourceDocumentRevisions, sourceDocuments } from "@/persistence";
import {
  lockBookForShare,
  lockLedgerForUpdate,
  lockSourceDocumentForUpdate,
} from "../transaction-locks";
import { completeProcessingLeaseInTransaction } from "../processing-terminal";

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

      // The book was resolved outside this transaction; the ledger lock makes
      // the re-read authoritative, so a book archived while the form was open
      // refuses here instead of gaining a record after retirement.
      await lockBookForShare(tx, input.ledgerId, input.bookId);

      const sourceDocumentId = input.sourceDocumentId ?? crypto.randomUUID();
      const revisionId = await createCompletedProjectionInTransaction(tx, {
        ledgerId: input.ledgerId,
        bookId: input.bookId,
        sourceDocumentId,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.entryDate !== undefined ? { entryDate: input.entryDate } : {}),
        ...(input.inputText !== undefined ? { inputText: input.inputText } : {}),
        entries: input.entries,
      });
      return { sourceDocumentId, revisionId };
    });
  },
};
