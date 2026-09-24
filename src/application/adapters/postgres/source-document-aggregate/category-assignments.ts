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
import { lockLedgerForUpdate } from "../transaction-locks";
import { assertSourceDocumentNotProcessing } from "@/modules/source-document/server/write-guards";
import { refreshCategoryAssignmentParentJob } from "../category-assignment-v2";
import { ConflictError } from "@/lib/errors";
import type {
  ApplyCategoryAssignmentsInput,
  ApplyCategoryAssignmentsResult,
} from "@/modules/source-document/application/ports";
import type { PostgresTransaction } from "../transaction-locks";

export async function incrementCategoryChangedDocumentVersions(
  tx: PostgresTransaction,
  ledgerId: string,
  sourceDocumentIds: readonly string[],
  now: Date
): Promise<void> {
  if (sourceDocumentIds.length === 0) return;
  await tx
    .update(sourceDocuments)
    .set({ version: sql`${sourceDocuments.version} + 1`, updatedAt: now })
    .where(
      and(
        eq(sourceDocuments.ledgerId, ledgerId),
        inArray(sourceDocuments.id, [...sourceDocumentIds])
      )
    );
}

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

    if (document == null || document.deletedAt != null || document.activeRevisionId == null) {
      return finishWithoutWrite("skipped", "document_unavailable");
    }
    if (
      document.version !== work.expectedVersion ||
      document.activeRevisionId !== work.revisionId
    ) {
      return finishWithoutWrite("conflict", "document_changed");
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
        revisionId: ledgerEntries.sourceDocumentRevisionId,
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
    if (
      selected.some(
        (entry) =>
          entry.deletedAt != null ||
          entry.revisionId !== document.activeRevisionId ||
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

    let appliedCount = 0;
    let confirmedCount = 0;
    for (const entry of selected) {
      const outcome =
        entry.currentCategoryId === entry.work.targetCategoryId ? "confirmed" : "applied";
      if (outcome === "applied") {
        await tx
          .update(ledgerEntries)
          .set({ categoryId: entry.work.targetCategoryId, updatedAt: now })
          .where(
            and(
              eq(ledgerEntries.ledgerId, input.ledgerId),
              eq(ledgerEntries.id, entry.work.ledgerEntryId),
              eq(ledgerEntries.sourceDocumentRevisionId, document.activeRevisionId)
            )
          );
        appliedCount += 1;
      } else confirmedCount += 1;
      await tx
        .update(categoryReclassificationJobEntries)
        .set({ outcome, errorCode: null, updatedAt: now })
        .where(
          and(
            eq(categoryReclassificationJobEntries.jobId, input.jobId),
            eq(categoryReclassificationJobEntries.ledgerEntryId, entry.work.ledgerEntryId)
          )
        );
    }
    const version = document.version + (appliedCount > 0 ? 1 : 0);
    if (appliedCount > 0) {
      await tx
        .update(sourceDocuments)
        .set({ version, updatedAt: now })
        .where(
          and(
            eq(sourceDocuments.ledgerId, input.ledgerId),
            eq(sourceDocuments.id, input.sourceDocumentId),
            eq(sourceDocuments.version, document.version)
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
    return { status: "applied", appliedCount, confirmedCount, version };
  });
}
