import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  categoryReclassificationJobDocuments,
  categoryReclassificationJobEntries,
  categoryReclassificationJobs,
  entryCategories,
  ledgerEntries,
  sourceDocuments,
} from "@/persistence";
import { lockLedgerForUpdate } from "@/lib/db/transaction-locks";
import { assertSourceDocumentNotProcessing } from "@/modules/source-document/server/write-guards";
import { leaseHeldBy } from "@/lib/db/lease";
import type { CategoryAssignmentLease } from "@/server/category-reclassification/assignments";
import { ConflictError } from "@/lib/errors";

export interface ApplyCategoryAssignmentsInput {
  lease: CategoryAssignmentLease;
  sourceDocumentId: string;
  now?: Date;
}

export type ApplyCategoryAssignmentsResult =
  | { status: "applied"; appliedCount: number; confirmedCount: number; conflictCount: number }
  | { status: "conflict" | "skipped" | "claim_lost" };

/**
 * Writes one document's decided categories and every entry's outcome. Locks
 * the ledger, then the document, then the job row, whose lease must still be
 * the caller's: a cancel or a newer worker makes this a no-op.
 */
export async function applyCategoryAssignments(
  input: ApplyCategoryAssignmentsInput
): Promise<ApplyCategoryAssignmentsResult> {
  const now = input.now ?? new Date();
  const { ledgerId, jobId, claimToken } = input.lease;
  return db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx, ledgerId);
    const document = await tx
      .select()
      .from(sourceDocuments)
      .where(
        and(eq(sourceDocuments.ledgerId, ledgerId), eq(sourceDocuments.id, input.sourceDocumentId))
      )
      .for("update")
      .then((rows) => rows[0]);
    const job = await tx
      .select({ id: categoryReclassificationJobs.id })
      .from(categoryReclassificationJobs)
      .where(
        and(
          eq(categoryReclassificationJobs.ledgerId, ledgerId),
          eq(categoryReclassificationJobs.id, jobId),
          leaseHeldBy(
            categoryReclassificationJobs.claimToken,
            categoryReclassificationJobs.claimExpiresAt,
            claimToken
          )
        )
      )
      .for("update")
      .then((rows) => rows[0]);
    if (job == null) return { status: "claim_lost" };
    const work = await tx
      .select({ status: categoryReclassificationJobDocuments.status })
      .from(categoryReclassificationJobDocuments)
      .where(
        and(
          eq(categoryReclassificationJobDocuments.ledgerId, ledgerId),
          eq(categoryReclassificationJobDocuments.jobId, jobId),
          eq(categoryReclassificationJobDocuments.sourceDocumentId, input.sourceDocumentId)
        )
      )
      .then((rows) => rows[0]);
    if (work?.status !== "pending") return { status: "claim_lost" };

    const finishWithoutWrite = async (status: "conflict" | "skipped", errorCode: string) => {
      await tx
        .update(categoryReclassificationJobEntries)
        .set({ outcome: status, errorCode, updatedAt: now })
        .where(
          and(
            eq(categoryReclassificationJobEntries.ledgerId, ledgerId),
            eq(categoryReclassificationJobEntries.jobId, jobId),
            eq(categoryReclassificationJobEntries.sourceDocumentId, input.sourceDocumentId),
            isNull(categoryReclassificationJobEntries.outcome)
          )
        );
      await tx
        .update(categoryReclassificationJobDocuments)
        .set({ status, errorCode, updatedAt: now })
        .where(
          and(
            eq(categoryReclassificationJobDocuments.jobId, jobId),
            eq(categoryReclassificationJobDocuments.sourceDocumentId, input.sourceDocumentId)
          )
        );
      return { status } as const;
    };

    if (document == null || document.deletedAt != null) {
      return finishWithoutWrite("skipped", "document_unavailable");
    }
    try {
      await assertSourceDocumentNotProcessing(tx, document);
    } catch (error) {
      if (error instanceof ConflictError) {
        return finishWithoutWrite("conflict", "document_changed");
      }
      throw error;
    }

    const selected = await tx
      .select({
        work: categoryReclassificationJobEntries,
        currentCategoryId: ledgerEntries.categoryId,
        sourceDocumentId: ledgerEntries.sourceDocumentId,
        deletedAt: ledgerEntries.deletedAt,
      })
      .from(categoryReclassificationJobEntries)
      .leftJoin(
        ledgerEntries,
        and(
          eq(ledgerEntries.ledgerId, ledgerId),
          eq(ledgerEntries.id, categoryReclassificationJobEntries.ledgerEntryId)
        )
      )
      .where(
        and(
          eq(categoryReclassificationJobEntries.ledgerId, ledgerId),
          eq(categoryReclassificationJobEntries.jobId, jobId),
          eq(categoryReclassificationJobEntries.sourceDocumentId, input.sourceDocumentId)
        )
      )
      .orderBy(categoryReclassificationJobEntries.selectionOrder);
    // A reparse replaces the entries and a split moves them to another
    // document; either way the selection no longer describes this one.
    if (
      selected.some(
        (entry) =>
          entry.deletedAt != null ||
          entry.sourceDocumentId !== input.sourceDocumentId ||
          !entry.work.decisionPersisted
      )
    ) {
      return finishWithoutWrite("skipped", "document_unavailable");
    }
    const categoryIds = [
      ...new Set(selected.map((entry) => entry.work.targetCategoryId).filter(Boolean)),
    ] as string[];
    if (categoryIds.length > 0) {
      const available = await tx
        .select({ id: entryCategories.id })
        .from(entryCategories)
        .where(
          and(
            eq(entryCategories.ledgerId, ledgerId),
            inArray(entryCategories.id, categoryIds),
            isNull(entryCategories.deletedAt)
          )
        );
      if (available.length !== categoryIds.length) {
        return finishWithoutWrite("conflict", "category_changed");
      }
    }

    // Each entry is written only if it still has the category it had when it
    // was selected; one changed since then is a conflict on its own, and the
    // document's other entries still apply.
    let appliedCount = 0;
    let confirmedCount = 0;
    let conflictCount = 0;
    for (const entry of selected) {
      let outcome: "applied" | "confirmed" | "conflict" = "confirmed";
      if (entry.currentCategoryId !== entry.work.targetCategoryId) {
        const written = await tx
          .update(ledgerEntries)
          .set({ categoryId: entry.work.targetCategoryId, updatedAt: now })
          .where(
            and(
              eq(ledgerEntries.ledgerId, ledgerId),
              eq(ledgerEntries.id, entry.work.ledgerEntryId),
              eq(ledgerEntries.sourceDocumentId, input.sourceDocumentId),
              isNull(ledgerEntries.deletedAt),
              sql`${ledgerEntries.categoryId} IS NOT DISTINCT FROM ${entry.work.originalCategoryId}`
            )
          )
          .returning({ id: ledgerEntries.id });
        outcome = written.length > 0 ? "applied" : "conflict";
      }
      if (outcome === "applied") appliedCount += 1;
      else if (outcome === "confirmed") confirmedCount += 1;
      else conflictCount += 1;
      await tx
        .update(categoryReclassificationJobEntries)
        .set({
          outcome,
          errorCode: outcome === "conflict" ? "entry_changed" : null,
          updatedAt: now,
        })
        .where(
          and(
            eq(categoryReclassificationJobEntries.jobId, jobId),
            eq(categoryReclassificationJobEntries.ledgerEntryId, entry.work.ledgerEntryId)
          )
        );
    }
    await tx
      .update(categoryReclassificationJobDocuments)
      .set({ status: "succeeded", errorCode: null, updatedAt: now })
      .where(
        and(
          eq(categoryReclassificationJobDocuments.jobId, jobId),
          eq(categoryReclassificationJobDocuments.sourceDocumentId, input.sourceDocumentId)
        )
      );
    return { status: "applied", appliedCount, confirmedCount, conflictCount };
  });
}
