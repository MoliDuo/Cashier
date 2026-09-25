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
import { refreshCategoryAssignmentParentJob } from "@/server/category-reclassification/assignments";
import { ConflictError } from "@/lib/errors";

export interface ApplyCategoryAssignmentsInput {
  ledgerId: string;
  jobId: string;
  sourceDocumentId: string;
  claimToken: string;
  now?: Date;
}

export type ApplyCategoryAssignmentsResult =
  | { status: "applied"; appliedCount: number; confirmedCount: number; conflictCount: number }
  | { status: "conflict" | "skipped" | "cancelled" | "claim_lost" };

export async function applyCategoryAssignments(
  input: ApplyCategoryAssignmentsInput
): Promise<ApplyCategoryAssignmentsResult> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx, input.ledgerId);
    const document = await tx
      .select()
      .from(sourceDocuments)
      .where(
        and(
          eq(sourceDocuments.ledgerId, input.ledgerId),
          eq(sourceDocuments.id, input.sourceDocumentId)
        )
      )
      .for("update")
      .then((rows) => rows[0]);
    const job = await tx
      .select({ status: categoryReclassificationJobs.status })
      .from(categoryReclassificationJobs)
      .where(
        and(
          eq(categoryReclassificationJobs.ledgerId, input.ledgerId),
          eq(categoryReclassificationJobs.id, input.jobId)
        )
      )
      .for("update")
      .then((rows) => rows[0]);
    const work = await tx
      .select()
      .from(categoryReclassificationJobDocuments)
      .where(
        and(
          eq(categoryReclassificationJobDocuments.ledgerId, input.ledgerId),
          eq(categoryReclassificationJobDocuments.jobId, input.jobId),
          eq(categoryReclassificationJobDocuments.sourceDocumentId, input.sourceDocumentId)
        )
      )
      .for("update")
      .then((rows) => rows[0]);
    if (
      work == null ||
      work.status !== "running" ||
      work.claimToken !== input.claimToken ||
      work.claimExpiresAt == null ||
      work.claimExpiresAt < now
    )
      return { status: "claim_lost" };
    if (job == null || job.status === "cancelled") {
      return { status: "cancelled" };
    }

    const finishWithoutWrite = async (status: "conflict" | "skipped", errorCode: string) => {
      await tx
        .update(categoryReclassificationJobEntries)
        .set({ outcome: status, errorCode, updatedAt: now })
        .where(
          and(
            eq(categoryReclassificationJobEntries.ledgerId, input.ledgerId),
            eq(categoryReclassificationJobEntries.jobId, input.jobId),
            eq(categoryReclassificationJobEntries.sourceDocumentId, input.sourceDocumentId),
            isNull(categoryReclassificationJobEntries.outcome)
          )
        );
      await tx
        .update(categoryReclassificationJobDocuments)
        .set({
          status,
          errorCode,
          claimToken: null,
          claimExpiresAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(categoryReclassificationJobDocuments.jobId, input.jobId),
            eq(categoryReclassificationJobDocuments.sourceDocumentId, input.sourceDocumentId)
          )
        );
      await refreshCategoryAssignmentParentJob(tx, input.jobId, input.ledgerId, now);
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
          eq(ledgerEntries.ledgerId, input.ledgerId),
          eq(ledgerEntries.id, categoryReclassificationJobEntries.ledgerEntryId)
        )
      )
      .where(
        and(
          eq(categoryReclassificationJobEntries.ledgerId, input.ledgerId),
          eq(categoryReclassificationJobEntries.jobId, input.jobId),
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
            eq(entryCategories.ledgerId, input.ledgerId),
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
              eq(ledgerEntries.ledgerId, input.ledgerId),
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
            eq(categoryReclassificationJobEntries.jobId, input.jobId),
            eq(categoryReclassificationJobEntries.ledgerEntryId, entry.work.ledgerEntryId)
          )
        );
    }
    await tx
      .update(categoryReclassificationJobDocuments)
      .set({
        status: "succeeded",
        errorCode: null,
        claimToken: null,
        claimExpiresAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(categoryReclassificationJobDocuments.jobId, input.jobId),
          eq(categoryReclassificationJobDocuments.sourceDocumentId, input.sourceDocumentId),
          eq(categoryReclassificationJobDocuments.claimToken, input.claimToken)
        )
      );
    await refreshCategoryAssignmentParentJob(tx, input.jobId, input.ledgerId, now);
    return { status: "applied", appliedCount, confirmedCount, conflictCount };
  });
}
