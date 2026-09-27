import { and, eq, sql } from "drizzle-orm";
import "server-only";
import type {
  ActivateAttemptInput,
  CreateManualDocumentInput,
} from "@/modules/source-document/server/projections/types";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { extractionAttempts, sourceDocuments } from "@/persistence";
import {
  lockBookForShare,
  lockLedgerForUpdate,
  lockSourceDocumentForUpdate,
} from "@/lib/db/transaction-locks";
import { closeProcessingLeaseInTransaction } from "@/server/processing/terminal";

import { activeDocumentWhere, replaceProjection } from "./shared";
import { createCompletedProjectionInTransaction } from "./manual-entries";

export async function activateAttempt(input: ActivateAttemptInput): Promise<boolean> {
  return db.transaction(async (tx) => {
    // The ledger lock keeps the categories the entries reference from being
    // deleted underneath the activation.
    await lockLedgerForUpdate(tx, input.ledgerId);

    // Also lock the source document row to serialise with concurrent soft-delete.
    // Lock order: ledger → source document (prevents deadlocks).
    let document: typeof sourceDocuments.$inferSelect;
    try {
      document = await lockSourceDocumentForUpdate(tx, input.ledgerId, input.sourceDocumentId);
    } catch (error) {
      if (error instanceof NotFoundError) return false;
      throw error;
    }
    if (document.latestAttemptId !== input.attemptId) return false;
    const attempt = await tx
      .select()
      .from(extractionAttempts)
      .where(
        and(
          eq(extractionAttempts.ledgerId, input.ledgerId),
          eq(extractionAttempts.sourceDocumentId, input.sourceDocumentId),
          eq(extractionAttempts.id, input.attemptId)
        )
      )
      .for("update")
      .then((rows) => rows[0]);
    if (attempt == null || attempt.status !== "processing") {
      return false;
    }
    if (!(await closeProcessingLeaseInTransaction(tx, input.lease))) {
      return false;
    }

    await replaceProjection(tx, {
      ledgerId: input.ledgerId,
      sourceDocumentId: input.sourceDocumentId,
      entries: input.entries,
    });
    const now = new Date();
    await tx
      .update(extractionAttempts)
      .set({
        status: "completed",
        finishedAt: now,
        failureKind: null,
        failureMessage: null,
        failureCode: null,
      })
      .where(eq(extractionAttempts.id, input.attemptId));
    await tx
      .update(sourceDocuments)
      .set({
        version: sql`${sourceDocuments.version} + 1`,
        documentDate: attempt.requestedDate,
        ...(input.title == null || input.title === "" ? {} : { title: input.title }),
        dateOrganizationSuggestion: input.dateOrganizationSuggestion ?? null,
        updatedAt: now,
      })
      .where(activeDocumentWhere(input.ledgerId, input.sourceDocumentId));
    return true;
  });
}

export async function createManualDocument(
  input: CreateManualDocumentInput
): Promise<{ sourceDocumentId: string }> {
  return db.transaction(async (tx) => {
    // The ledger lock keeps the categories the entries reference from being
    // deleted underneath the new record.
    await lockLedgerForUpdate(tx, input.ledgerId);

    // The book was resolved outside this transaction; the ledger lock makes
    // the re-read authoritative, so a book archived while the form was open
    // refuses here instead of gaining a record after retirement.
    await lockBookForShare(tx, input.ledgerId, input.bookId);

    const sourceDocumentId = input.sourceDocumentId ?? crypto.randomUUID();
    await createCompletedProjectionInTransaction(tx, {
      ledgerId: input.ledgerId,
      bookId: input.bookId,
      sourceDocumentId,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.entryDate !== undefined ? { entryDate: input.entryDate } : {}),
      ...(input.inputText !== undefined ? { inputText: input.inputText } : {}),
      entries: input.entries,
    });
    return { sourceDocumentId };
  });
}
