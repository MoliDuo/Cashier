import { and, eq, sql } from "drizzle-orm";
import "server-only";
import type { ActivateAttemptInput } from "@/modules/source-document/server/projections/types";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { extractionAttempts, sourceDocuments } from "@/persistence";
import {
  lockLedgerForUpdate,
  lockSourceDocumentForUpdate,
  type LockedSourceDocument,
} from "@/lib/db/transaction-locks";
import { closeProcessingLeaseInTransaction } from "@/server/processing/terminal";

import { activeDocumentWhere, replaceProjection } from "./shared";

export async function activateAttempt(input: ActivateAttemptInput): Promise<boolean> {
  return db.transaction(async (tx) => {
    // The ledger lock keeps the categories the entries reference from being
    // deleted underneath the activation.
    await lockLedgerForUpdate(tx, input.ledgerId);

    // Also lock the source document row to serialise with a concurrent delete.
    // Lock order: ledger → source document (prevents deadlocks).
    let document: LockedSourceDocument;
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
