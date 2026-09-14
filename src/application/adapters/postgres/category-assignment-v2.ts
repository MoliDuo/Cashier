import crypto from "node:crypto";
import { and, asc, count, eq, inArray, isNull, lt, max, min, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  categoryAssignmentSelectionChunks,
  categoryReclassificationJobDocuments,
  categoryReclassificationJobEntries,
  categoryReclassificationJobs,
  entryCategories,
  ledgerEntries,
  sourceDocuments,
} from "@/persistence";
import type {
  CategoryAssignmentCandidateSnapshot,
  CategoryAssignmentEntryResultDto,
  CategoryAssignmentMode,
  CategoryAssignmentResultPageDto,
  CategoryAssignmentSelectionEntry,
} from "@/modules/ledger/contracts";
import { lockLedgerForUpdate } from "./transaction-locks";
import type { PostgresTransaction } from "./transaction-locks";

const PREPARING_TTL_MS = 15 * 60_000;

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function violatesConstraint(error: unknown, constraint: string): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && candidate != null; depth += 1) {
    if (
      candidate instanceof Error &&
      "code" in candidate &&
      (candidate as { code?: unknown }).code === "23505" &&
      "constraint" in candidate &&
      (candidate as { constraint?: unknown }).constraint === constraint
    ) {
      return true;
    }
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return false;
}

function modeColumns(mode: CategoryAssignmentMode) {
  return {
    mode: mode.kind,
    directCategoryId: mode.kind === "assign" ? mode.categoryId : null,
    candidateCategoryIds: mode.kind === "ai" ? mode.candidateCategoryIds : [],
  } as const;
}

function rowMode(row: {
  mode: "ai" | "assign" | "clear";
  directCategoryId: string | null;
  candidateCategoryIds: string[];
}): CategoryAssignmentMode {
  if (row.mode === "assign") return { kind: "assign", categoryId: row.directCategoryId! };
  if (row.mode === "clear") return { kind: "clear" };
  return { kind: "ai", candidateCategoryIds: row.candidateCategoryIds };
}

export interface BeginCategoryAssignmentRecord {
  id: string;
  status: "preparing" | "pending" | "running" | "succeeded" | "partial" | "failed" | "cancelled";
  receivedEntryCount: number;
  declaredEntryCount: number;
}

export interface ClaimedCategoryAssignmentDocument {
  jobId: string;
  ledgerId: string;
  sourceDocumentId: string;
  expectedVersion: number;
  revisionId: string;
  claimToken: string;
  attempts: number;
  mode: CategoryAssignmentMode;
  candidates: CategoryAssignmentCandidateSnapshot[];
  customPrompt: string | null;
}

export async function refreshCategoryAssignmentParentJob(
  tx: PostgresTransaction,
  jobId: string,
  ledgerId: string,
  now: Date
): Promise<void> {
  const result = await tx.execute<{
    total: string;
    applied: string;
    confirmed: string;
    failed: string;
    conflict: string;
    skipped: string;
    cancelled: string;
    document_total: string;
    document_completed: string;
  }>(sql`
    SELECT
      count(entry.ledger_entry_id)::text AS total,
      count(*) FILTER (WHERE entry.outcome = 'applied')::text AS applied,
      count(*) FILTER (WHERE entry.outcome = 'confirmed')::text AS confirmed,
      count(*) FILTER (WHERE entry.outcome = 'failed')::text AS failed,
      count(*) FILTER (WHERE entry.outcome = 'conflict')::text AS conflict,
      count(*) FILTER (WHERE entry.outcome = 'skipped')::text AS skipped,
      count(*) FILTER (WHERE entry.outcome = 'cancelled')::text AS cancelled,
      (SELECT count(*) FROM ${categoryReclassificationJobDocuments} document
        WHERE document.job_id = ${jobId} AND document.ledger_id = ${ledgerId})::text AS document_total,
      (SELECT count(*) FROM ${categoryReclassificationJobDocuments} document
        WHERE document.job_id = ${jobId} AND document.ledger_id = ${ledgerId}
          AND document.status IN ('succeeded', 'failed', 'conflict', 'skipped', 'cancelled'))::text AS document_completed
    FROM ${categoryReclassificationJobEntries} entry
    WHERE entry.job_id = ${jobId} AND entry.ledger_id = ${ledgerId}
  `);
  const row = result.rows[0]!;
  const counts = {
    total: Number(row.total),
    applied: Number(row.applied),
    confirmed: Number(row.confirmed),
    failed: Number(row.failed),
    conflict: Number(row.conflict),
    skipped: Number(row.skipped),
    cancelled: Number(row.cancelled),
    documentTotal: Number(row.document_total),
    documentCompleted: Number(row.document_completed),
  };
  const done = counts.documentCompleted === counts.documentTotal;
  const successful = counts.applied + counts.confirmed;
  const problematic = counts.failed + counts.conflict + counts.skipped;
  const status = !done
    ? "running"
    : counts.cancelled > 0
      ? "cancelled"
      : problematic === 0
        ? "succeeded"
        : successful === 0 && counts.failed > 0 && counts.conflict + counts.skipped === 0
          ? "failed"
          : "partial";
  await tx
    .update(categoryReclassificationJobs)
    .set({
      status,
      appliedCount: counts.applied,
      confirmedCount: counts.confirmed,
      failedCount: counts.failed,
      conflictCount: counts.conflict,
      skippedCount: counts.skipped,
      cancelledCount: counts.cancelled,
      documentTotal: counts.documentTotal,
      documentCompleted: counts.documentCompleted,
      completedAt: done ? now : null,
      updatedAt: now,
    })
    .where(
      and(
        eq(categoryReclassificationJobs.id, jobId),
        eq(categoryReclassificationJobs.ledgerId, ledgerId)
      )
    );
}

const refreshParentJob = refreshCategoryAssignmentParentJob;

export const postgresCategoryAssignmentV2Adapter = {
  async getProgressMetrics(input: { ledgerId: string; jobId: string; now?: Date }) {
    const now = input.now ?? new Date();
    const result = await db.execute<{
      active_count: string;
      retrying_count: string;
      next_retry_at: Date | null;
      evidence_incomplete: boolean;
    }>(sql`
      SELECT
        count(*) FILTER (
          WHERE status = 'running' AND claim_expires_at >= ${now}
        )::text AS active_count,
        count(*) FILTER (
          WHERE status = 'pending' AND attempts > 0
        )::text AS retrying_count,
        min(next_attempt_at) FILTER (
          WHERE status = 'pending' AND attempts > 0
        ) AS next_retry_at,
        coalesce(bool_or(evidence_incomplete), false) AS evidence_incomplete
      FROM ${categoryReclassificationJobDocuments}
      WHERE job_id = ${input.jobId} AND ledger_id = ${input.ledgerId}
    `);
    const row = result.rows[0];
    return {
      activeDocumentCount: Number(row?.active_count ?? 0),
      retryingDocumentCount: Number(row?.retrying_count ?? 0),
      nextRetryAt: row?.next_retry_at == null ? null : new Date(row.next_retry_at).toISOString(),
      evidenceIncomplete: row?.evidence_incomplete === true,
    };
  },

  async begin(input: {
    ledgerId: string;
    requestKey: string;
    mode: CategoryAssignmentMode;
    expectedEntryCount: number;
    candidates: CategoryAssignmentCandidateSnapshot[];
    customPrompt: string | null;
    parentJobId?: string;
    now?: Date;
  }): Promise<BeginCategoryAssignmentRecord> {
    const now = input.now ?? new Date();
    try {
      return await db.transaction(async (tx) => {
        await lockLedgerForUpdate(tx, input.ledgerId);
        const expired = await tx
          .update(categoryReclassificationJobs)
          .set({
            status: "cancelled",
            lastError: "selection_upload_expired",
            cancelledCount: sql`${categoryReclassificationJobs.declaredEntryCount}`,
            completedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(categoryReclassificationJobs.ledgerId, input.ledgerId),
              eq(categoryReclassificationJobs.status, "preparing"),
              lt(categoryReclassificationJobs.updatedAt, new Date(now.getTime() - PREPARING_TTL_MS))
            )
          )
          .returning({ id: categoryReclassificationJobs.id });
        const expiredIds = expired.map((job) => job.id);
        if (expiredIds.length > 0) {
          await tx
            .update(categoryReclassificationJobEntries)
            .set({ outcome: "cancelled", errorCode: "selection_upload_expired", updatedAt: now })
            .where(
              and(
                inArray(categoryReclassificationJobEntries.jobId, expiredIds),
                eq(categoryReclassificationJobEntries.ledgerId, input.ledgerId),
                isNull(categoryReclassificationJobEntries.outcome)
              )
            );
          await tx
            .update(categoryReclassificationJobDocuments)
            .set({
              status: "cancelled",
              errorCode: "selection_upload_expired",
              claimToken: null,
              claimExpiresAt: null,
              updatedAt: now,
            })
            .where(
              and(
                inArray(categoryReclassificationJobDocuments.jobId, expiredIds),
                eq(categoryReclassificationJobDocuments.ledgerId, input.ledgerId)
              )
            );
        }

        const replay = await tx
          .select()
          .from(categoryReclassificationJobs)
          .where(
            and(
              eq(categoryReclassificationJobs.ledgerId, input.ledgerId),
              eq(categoryReclassificationJobs.requestKey, input.requestKey)
            )
          )
          .then((rows) => rows[0]);
        if (replay != null) {
          if (
            replay.declaredEntryCount !== input.expectedEntryCount ||
            !sameJson(rowMode(replay), input.mode) ||
            !sameJson(replay.candidateSnapshot, input.candidates)
          ) {
            throw new ConflictError(
              "Category assignment request key was reused with different input"
            );
          }
          return {
            id: replay.id,
            status: replay.status,
            receivedEntryCount: replay.receivedEntryCount,
            declaredEntryCount: replay.declaredEntryCount,
          };
        }

        const [created] = await tx
          .insert(categoryReclassificationJobs)
          .values({
            ledgerId: input.ledgerId,
            status: "preparing",
            formatVersion: 2,
            requestKey: input.requestKey,
            declaredEntryCount: input.expectedEntryCount,
            candidateSnapshot: input.candidates,
            customPromptSnapshot: input.customPrompt,
            parentJobId: input.parentJobId ?? null,
            ...modeColumns(input.mode),
            nextAttemptAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (created == null) throw new ConflictError("Category assignment could not be created");
        return {
          id: created.id,
          status: created.status,
          receivedEntryCount: 0,
          declaredEntryCount: created.declaredEntryCount,
        };
      });
    } catch (error) {
      if (violatesConstraint(error, "uq_category_reclassification_jobs_active")) {
        throw new ConflictError("A category assignment is already active for this ledger");
      }
      throw error;
    }
  },

  async resolveSelection(ledgerId: string, ledgerEntryIds: readonly string[]) {
    if (ledgerEntryIds.length === 0) return [];
    const uniqueIds = [...new Set(ledgerEntryIds)];
    const rows = await db
      .select({
        ledgerEntryId: ledgerEntries.id,
        sourceDocumentId: sourceDocuments.id,
        expectedVersion: sourceDocuments.version,
      })
      .from(ledgerEntries)
      .innerJoin(
        sourceDocuments,
        and(
          eq(sourceDocuments.id, ledgerEntries.sourceDocumentId),
          eq(sourceDocuments.ledgerId, ledgerId),
          eq(sourceDocuments.activeRevisionId, ledgerEntries.sourceDocumentRevisionId),
          isNull(sourceDocuments.deletedAt)
        )
      )
      .where(
        and(
          eq(ledgerEntries.ledgerId, ledgerId),
          inArray(ledgerEntries.id, uniqueIds),
          isNull(ledgerEntries.deletedAt)
        )
      );
    const byId = new Map(rows.map((row) => [row.ledgerEntryId, row]));
    if (byId.size !== uniqueIds.length) {
      throw new ValidationError("Every selected entry must belong to an active document");
    }
    return uniqueIds.map((id) => byId.get(id)!);
  },

  async resolveLatestConflictSelection(input: { ledgerId: string; jobId: string }) {
    const original = await db
      .select()
      .from(categoryReclassificationJobs)
      .where(
        and(
          eq(categoryReclassificationJobs.ledgerId, input.ledgerId),
          eq(categoryReclassificationJobs.id, input.jobId),
          eq(categoryReclassificationJobs.formatVersion, 2),
          inArray(categoryReclassificationJobs.status, ["partial", "failed", "cancelled"])
        )
      )
      .then((rows) => rows[0]);
    if (original == null || original.conflictCount === 0) {
      throw new ValidationError("This assignment has no conflicts to categorize again");
    }
    const entries = await db
      .select({
        ledgerEntryId: ledgerEntries.id,
        sourceDocumentId: sourceDocuments.id,
        expectedVersion: sourceDocuments.version,
      })
      .from(categoryReclassificationJobEntries)
      .innerJoin(
        ledgerEntries,
        and(
          eq(ledgerEntries.ledgerId, input.ledgerId),
          eq(ledgerEntries.id, categoryReclassificationJobEntries.ledgerEntryId),
          isNull(ledgerEntries.deletedAt)
        )
      )
      .innerJoin(
        sourceDocuments,
        and(
          eq(sourceDocuments.ledgerId, input.ledgerId),
          eq(sourceDocuments.id, ledgerEntries.sourceDocumentId),
          eq(sourceDocuments.activeRevisionId, ledgerEntries.sourceDocumentRevisionId),
          isNull(sourceDocuments.deletedAt)
        )
      )
      .where(
        and(
          eq(categoryReclassificationJobEntries.ledgerId, input.ledgerId),
          eq(categoryReclassificationJobEntries.jobId, input.jobId),
          eq(categoryReclassificationJobEntries.outcome, "conflict")
        )
      )
      .orderBy(categoryReclassificationJobEntries.selectionOrder);
    if (entries.length === 0) {
      throw new ValidationError(
        "Conflicted entries are no longer current; select their replacements from Details"
      );
    }
    return { mode: rowMode(original), parentJobId: original.id, entries };
  },

  async append(input: {
    ledgerId: string;
    jobId: string;
    chunkIndex: number;
    entries: readonly CategoryAssignmentSelectionEntry[];
    now?: Date;
  }): Promise<{ receivedEntryCount: number }> {
    const now = input.now ?? new Date();
    const contentHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(input.entries))
      .digest("hex");
    return db.transaction(async (tx) => {
      await lockLedgerForUpdate(tx, input.ledgerId);
      const job = await tx
        .select()
        .from(categoryReclassificationJobs)
        .where(
          and(
            eq(categoryReclassificationJobs.id, input.jobId),
            eq(categoryReclassificationJobs.ledgerId, input.ledgerId)
          )
        )
        .for("update")
        .then((rows) => rows[0]);
      if (job == null) throw new NotFoundError("Category assignment job");
      const existingChunk = await tx
        .select()
        .from(categoryAssignmentSelectionChunks)
        .where(
          and(
            eq(categoryAssignmentSelectionChunks.jobId, input.jobId),
            eq(categoryAssignmentSelectionChunks.ledgerId, input.ledgerId),
            eq(categoryAssignmentSelectionChunks.chunkIndex, input.chunkIndex)
          )
        )
        .then((rows) => rows[0]);
      if (existingChunk != null) {
        if (existingChunk.contentHash !== contentHash) {
          throw new ConflictError("Selection chunk was replayed with different content");
        }
        return { receivedEntryCount: job.receivedEntryCount };
      }
      if (job.status !== "preparing") throw new ConflictError("Selection upload is not active");
      const maxIndexRow = await tx
        .select({ maxIndex: max(categoryAssignmentSelectionChunks.chunkIndex) })
        .from(categoryAssignmentSelectionChunks)
        .where(eq(categoryAssignmentSelectionChunks.jobId, input.jobId))
        .then((rows) => rows[0]);
      const maxIndex = maxIndexRow?.maxIndex ?? null;
      if (input.chunkIndex !== (maxIndex == null ? 0 : Number(maxIndex) + 1)) {
        throw new ConflictError("Selection chunks must be appended in order");
      }

      const uniqueEntryIds = [...new Set(input.entries.map((entry) => entry.ledgerEntryId))];
      const rows = await tx
        .select({
          id: ledgerEntries.id,
          categoryId: ledgerEntries.categoryId,
          sourceDocumentId: ledgerEntries.sourceDocumentId,
          revisionId: ledgerEntries.sourceDocumentRevisionId,
          documentVersion: sourceDocuments.version,
          activeRevisionId: sourceDocuments.activeRevisionId,
        })
        .from(ledgerEntries)
        .innerJoin(
          sourceDocuments,
          and(
            eq(sourceDocuments.id, ledgerEntries.sourceDocumentId),
            eq(sourceDocuments.ledgerId, input.ledgerId),
            isNull(sourceDocuments.deletedAt)
          )
        )
        .where(
          and(
            eq(ledgerEntries.ledgerId, input.ledgerId),
            inArray(ledgerEntries.id, uniqueEntryIds),
            isNull(ledgerEntries.deletedAt)
          )
        );
      const byId = new Map(rows.map((row) => [row.id, row]));
      if (byId.size !== uniqueEntryIds.length)
        throw new ValidationError("Selection contains unavailable entries");

      const documents = new Map<
        string,
        { expectedVersion: number; revisionId: string; firstSelectionOrder: number }
      >();
      input.entries.forEach((entry, index) => {
        const row = byId.get(entry.ledgerEntryId)!;
        if (
          row.sourceDocumentId !== entry.sourceDocumentId ||
          row.documentVersion !== entry.expectedVersion ||
          row.revisionId == null ||
          row.revisionId !== row.activeRevisionId
        ) {
          throw new ConflictError("Selected entry or document changed during upload");
        }
        const selectionOrder = input.chunkIndex * 1000 + index;
        const existing = documents.get(entry.sourceDocumentId);
        if (existing == null || selectionOrder < existing.firstSelectionOrder) {
          documents.set(entry.sourceDocumentId, {
            expectedVersion: entry.expectedVersion,
            revisionId: row.revisionId,
            firstSelectionOrder: selectionOrder,
          });
        }
      });

      for (const [sourceDocumentId, document] of documents) {
        await tx
          .insert(categoryReclassificationJobDocuments)
          .values({
            jobId: input.jobId,
            ledgerId: input.ledgerId,
            sourceDocumentId,
            ...document,
            nextAttemptAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
        const stored = await tx
          .select()
          .from(categoryReclassificationJobDocuments)
          .where(
            and(
              eq(categoryReclassificationJobDocuments.jobId, input.jobId),
              eq(categoryReclassificationJobDocuments.sourceDocumentId, sourceDocumentId)
            )
          )
          .then((result) => result[0]);
        if (
          stored == null ||
          stored.ledgerId !== input.ledgerId ||
          stored.expectedVersion !== document.expectedVersion ||
          stored.revisionId !== document.revisionId
        ) {
          throw new ConflictError("A document selection was uploaded with inconsistent versions");
        }
      }

      for (let index = 0; index < input.entries.length; index += 1) {
        const entry = input.entries[index]!;
        const row = byId.get(entry.ledgerEntryId)!;
        await tx
          .insert(categoryReclassificationJobEntries)
          .values({
            jobId: input.jobId,
            ledgerId: input.ledgerId,
            ledgerEntryId: entry.ledgerEntryId,
            sourceDocumentId: entry.sourceDocumentId,
            expectedVersion: entry.expectedVersion,
            selectionOrder: input.chunkIndex * 1000 + index,
            originalCategoryId: row.categoryId,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
      }
      await tx.insert(categoryAssignmentSelectionChunks).values({
        jobId: input.jobId,
        ledgerId: input.ledgerId,
        chunkIndex: input.chunkIndex,
        contentHash,
        entryCount: input.entries.length,
        createdAt: now,
      });
      const value = await tx
        .select({ value: count() })
        .from(categoryReclassificationJobEntries)
        .where(
          and(
            eq(categoryReclassificationJobEntries.jobId, input.jobId),
            eq(categoryReclassificationJobEntries.ledgerId, input.ledgerId)
          )
        )
        .then((rows) => rows[0]?.value ?? 0);
      const receivedEntryCount = Number(value);
      await tx
        .update(categoryReclassificationJobs)
        .set({ receivedEntryCount, updatedAt: now })
        .where(
          and(
            eq(categoryReclassificationJobs.id, input.jobId),
            eq(categoryReclassificationJobs.ledgerId, input.ledgerId)
          )
        );
      return { receivedEntryCount };
    });
  },

  async commit(input: {
    ledgerId: string;
    jobId: string;
    expectedEntryCount: number;
    now?: Date;
  }): Promise<BeginCategoryAssignmentRecord> {
    const now = input.now ?? new Date();
    return db.transaction(async (tx) => {
      await lockLedgerForUpdate(tx, input.ledgerId);
      const job = await tx
        .select()
        .from(categoryReclassificationJobs)
        .where(
          and(
            eq(categoryReclassificationJobs.id, input.jobId),
            eq(categoryReclassificationJobs.ledgerId, input.ledgerId)
          )
        )
        .for("update")
        .then((rows) => rows[0]);
      if (job == null) throw new NotFoundError("Category assignment job");
      if (job.status !== "preparing") {
        if (job.declaredEntryCount === input.expectedEntryCount) {
          return {
            id: job.id,
            status: job.status,
            receivedEntryCount: job.receivedEntryCount,
            declaredEntryCount: job.declaredEntryCount,
          };
        }
        throw new ConflictError("Category assignment was committed with a different count");
      }
      if (
        job.declaredEntryCount !== input.expectedEntryCount ||
        job.receivedEntryCount !== input.expectedEntryCount
      ) {
        throw new ConflictError("Selection upload count does not match the declared count");
      }
      const documents = await tx
        .select({
          work: categoryReclassificationJobDocuments,
          version: sourceDocuments.version,
          activeRevisionId: sourceDocuments.activeRevisionId,
          deletedAt: sourceDocuments.deletedAt,
        })
        .from(categoryReclassificationJobDocuments)
        .innerJoin(
          sourceDocuments,
          and(
            eq(sourceDocuments.id, categoryReclassificationJobDocuments.sourceDocumentId),
            eq(sourceDocuments.ledgerId, input.ledgerId)
          )
        )
        .where(
          and(
            eq(categoryReclassificationJobDocuments.jobId, input.jobId),
            eq(categoryReclassificationJobDocuments.ledgerId, input.ledgerId)
          )
        )
        .orderBy(asc(categoryReclassificationJobDocuments.sourceDocumentId))
        .for("update");
      if (
        documents.some(
          ({ work, version, activeRevisionId, deletedAt }) =>
            deletedAt != null ||
            version !== work.expectedVersion ||
            activeRevisionId !== work.revisionId
        )
      ) {
        throw new ConflictError("A selected document changed before the assignment was committed");
      }

      if (job.mode === "assign") {
        const category = await tx
          .select({ id: entryCategories.id })
          .from(entryCategories)
          .where(
            and(
              eq(entryCategories.id, job.directCategoryId!),
              eq(entryCategories.ledgerId, input.ledgerId),
              isNull(entryCategories.deletedAt)
            )
          )
          .then((rows) => rows[0]);
        if (category == null) throw new ConflictError("Target category changed before commit");
      }
      if (job.mode !== "ai") {
        await tx
          .update(categoryReclassificationJobEntries)
          .set({
            targetCategoryId: job.mode === "assign" ? job.directCategoryId : null,
            decisionPersisted: true,
            updatedAt: now,
          })
          .where(
            and(
              eq(categoryReclassificationJobEntries.jobId, input.jobId),
              eq(categoryReclassificationJobEntries.ledgerId, input.ledgerId)
            )
          );
      }
      const [updated] = await tx
        .update(categoryReclassificationJobs)
        .set({
          status: "pending",
          documentTotal: documents.length,
          nextAttemptAt: now,
          updatedAt: now,
        })
        .where(eq(categoryReclassificationJobs.id, input.jobId))
        .returning();
      return {
        id: updated!.id,
        status: updated!.status,
        receivedEntryCount: updated!.receivedEntryCount,
        declaredEntryCount: updated!.declaredEntryCount,
      };
    });
  },

  async claimDocuments(input: {
    now: Date;
    leaseMs: number;
    concurrency: number;
    jobId?: string;
    ledgerId?: string;
  }): Promise<ClaimedCategoryAssignmentDocument[]> {
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('cashier:category-assignment-slots:v2'))`
      );
      const activeResult = await tx.execute<{ count: string }>(sql`
        SELECT count(*)::text AS count
        FROM ${categoryReclassificationJobDocuments}
        WHERE ${categoryReclassificationJobDocuments.status} = 'running'
          AND ${categoryReclassificationJobDocuments.claimExpiresAt} >= ${input.now}
      `);
      const available = Math.max(0, input.concurrency - Number(activeResult.rows[0]?.count ?? 0));
      if (available === 0) return [];
      const claimed = await tx.execute<{
        job_id: string;
        ledger_id: string;
        source_document_id: string;
        expected_version: number;
        revision_id: string;
        claim_token: string;
        attempts: number;
        mode: "ai" | "assign" | "clear";
        direct_category_id: string | null;
        candidate_category_ids: string[];
        candidate_snapshot: CategoryAssignmentCandidateSnapshot[];
        custom_prompt_snapshot: string | null;
      }>(sql`
        WITH candidates AS (
          SELECT work.job_id, work.source_document_id
          FROM ${categoryReclassificationJobDocuments} AS work
          INNER JOIN ${categoryReclassificationJobs} AS job
            ON job.id = work.job_id AND job.ledger_id = work.ledger_id
          WHERE job.format_version = 2
            AND job.status IN ('pending', 'running')
            AND work.next_attempt_at <= ${input.now}
            AND (
              work.status = 'pending'
              OR (work.status = 'running' AND work.claim_expires_at < ${input.now})
            )
            ${input.jobId == null ? sql`` : sql`AND job.id = ${input.jobId}`}
            ${input.ledgerId == null ? sql`` : sql`AND job.ledger_id = ${input.ledgerId}`}
          ORDER BY work.next_attempt_at, work.first_selection_order
          LIMIT ${available}
          FOR UPDATE OF work SKIP LOCKED
        ), claimed AS (
          UPDATE ${categoryReclassificationJobDocuments} AS work
          SET status = 'running',
              claim_token = gen_random_uuid(),
              claim_expires_at = ${leaseExpiresAt},
              claim_started_at = ${input.now},
              heartbeat_at = ${input.now},
              attempts = work.attempts + 1,
              updated_at = ${input.now}
          FROM candidates
          WHERE work.job_id = candidates.job_id
            AND work.source_document_id = candidates.source_document_id
          RETURNING work.*
        )
        SELECT claimed.job_id, claimed.ledger_id, claimed.source_document_id,
          claimed.expected_version, claimed.revision_id, claimed.claim_token,
          claimed.attempts, job.mode, job.direct_category_id,
          job.candidate_category_ids, job.candidate_snapshot, job.custom_prompt_snapshot
        FROM claimed
        INNER JOIN ${categoryReclassificationJobs} AS job ON job.id = claimed.job_id
      `);
      const jobIds = [...new Set(claimed.rows.map((row) => row.job_id))];
      if (jobIds.length > 0) {
        await tx
          .update(categoryReclassificationJobs)
          .set({ status: "running", updatedAt: input.now })
          .where(inArray(categoryReclassificationJobs.id, jobIds));
      }
      return claimed.rows.map((row) => ({
        jobId: row.job_id,
        ledgerId: row.ledger_id,
        sourceDocumentId: row.source_document_id,
        expectedVersion: row.expected_version,
        revisionId: row.revision_id,
        claimToken: row.claim_token,
        attempts: row.attempts,
        mode: rowMode({
          mode: row.mode,
          directCategoryId: row.direct_category_id,
          candidateCategoryIds: row.candidate_category_ids,
        }),
        candidates: row.candidate_snapshot,
        customPrompt: row.custom_prompt_snapshot,
      }));
    });
  },

  async loadDocumentSelection(input: {
    ledgerId: string;
    jobId: string;
    sourceDocumentId: string;
  }): Promise<{ entryIds: string[]; completedChunkCount: number }> {
    const [entries, work] = await Promise.all([
      db
        .select({ id: categoryReclassificationJobEntries.ledgerEntryId })
        .from(categoryReclassificationJobEntries)
        .where(
          and(
            eq(categoryReclassificationJobEntries.ledgerId, input.ledgerId),
            eq(categoryReclassificationJobEntries.jobId, input.jobId),
            eq(categoryReclassificationJobEntries.sourceDocumentId, input.sourceDocumentId)
          )
        )
        .orderBy(categoryReclassificationJobEntries.selectionOrder),
      db
        .select({ completedChunkCount: categoryReclassificationJobDocuments.completedChunkCount })
        .from(categoryReclassificationJobDocuments)
        .where(
          and(
            eq(categoryReclassificationJobDocuments.ledgerId, input.ledgerId),
            eq(categoryReclassificationJobDocuments.jobId, input.jobId),
            eq(categoryReclassificationJobDocuments.sourceDocumentId, input.sourceDocumentId)
          )
        )
        .then((rows) => rows[0]),
    ]);
    if (work == null) throw new NotFoundError("Category assignment document");
    return {
      entryIds: entries.map((entry) => entry.id),
      completedChunkCount: work.completedChunkCount,
    };
  },

  async nextDue(input: { jobId?: string; ledgerId?: string }): Promise<Date | null> {
    const row = await db
      .select({ nextAttemptAt: min(categoryReclassificationJobDocuments.nextAttemptAt) })
      .from(categoryReclassificationJobDocuments)
      .innerJoin(
        categoryReclassificationJobs,
        and(
          eq(categoryReclassificationJobs.id, categoryReclassificationJobDocuments.jobId),
          eq(categoryReclassificationJobs.ledgerId, categoryReclassificationJobDocuments.ledgerId)
        )
      )
      .where(
        and(
          inArray(categoryReclassificationJobs.status, ["pending", "running"]),
          eq(categoryReclassificationJobDocuments.status, "pending"),
          input.jobId == null ? undefined : eq(categoryReclassificationJobs.id, input.jobId),
          input.ledgerId == null
            ? undefined
            : eq(categoryReclassificationJobs.ledgerId, input.ledgerId)
        )
      )
      .then((rows) => rows[0]);
    return row?.nextAttemptAt ?? null;
  },

  async markEvidenceIncomplete(input: {
    ledgerId: string;
    jobId: string;
    sourceDocumentId: string;
    claimToken: string;
    now?: Date;
  }): Promise<void> {
    const now = input.now ?? new Date();
    await db
      .update(categoryReclassificationJobDocuments)
      .set({ evidenceIncomplete: true, updatedAt: now })
      .where(
        and(
          eq(categoryReclassificationJobDocuments.ledgerId, input.ledgerId),
          eq(categoryReclassificationJobDocuments.jobId, input.jobId),
          eq(categoryReclassificationJobDocuments.sourceDocumentId, input.sourceDocumentId),
          eq(categoryReclassificationJobDocuments.claimToken, input.claimToken),
          eq(categoryReclassificationJobDocuments.status, "running")
        )
      );
  },

  async persistDecisions(input: {
    ledgerId: string;
    jobId: string;
    sourceDocumentId: string;
    claimToken: string;
    decisions: readonly { ledgerEntryId: string; categoryId: string }[];
    completedChunkCount: number;
    now?: Date;
  }): Promise<boolean> {
    const now = input.now ?? new Date();
    return db.transaction(async (tx) => {
      const work = await tx
        .select({
          claimToken: categoryReclassificationJobDocuments.claimToken,
          claimExpiresAt: categoryReclassificationJobDocuments.claimExpiresAt,
        })
        .from(categoryReclassificationJobDocuments)
        .where(
          and(
            eq(categoryReclassificationJobDocuments.ledgerId, input.ledgerId),
            eq(categoryReclassificationJobDocuments.jobId, input.jobId),
            eq(categoryReclassificationJobDocuments.sourceDocumentId, input.sourceDocumentId),
            eq(categoryReclassificationJobDocuments.status, "running")
          )
        )
        .for("update")
        .then((rows) => rows[0]);
      if (
        work == null ||
        work.claimToken !== input.claimToken ||
        work.claimExpiresAt == null ||
        work.claimExpiresAt < now
      )
        return false;
      for (const decision of input.decisions) {
        const updated = await tx
          .update(categoryReclassificationJobEntries)
          .set({ targetCategoryId: decision.categoryId, decisionPersisted: true, updatedAt: now })
          .where(
            and(
              eq(categoryReclassificationJobEntries.ledgerId, input.ledgerId),
              eq(categoryReclassificationJobEntries.jobId, input.jobId),
              eq(categoryReclassificationJobEntries.sourceDocumentId, input.sourceDocumentId),
              eq(categoryReclassificationJobEntries.ledgerEntryId, decision.ledgerEntryId),
              isNull(categoryReclassificationJobEntries.outcome)
            )
          )
          .returning({ id: categoryReclassificationJobEntries.ledgerEntryId });
        if (updated.length !== 1)
          throw new ConflictError("AI returned an entry outside the claimed request block");
      }
      await tx
        .update(categoryReclassificationJobDocuments)
        .set({ completedChunkCount: input.completedChunkCount, heartbeatAt: now, updatedAt: now })
        .where(
          and(
            eq(categoryReclassificationJobDocuments.jobId, input.jobId),
            eq(categoryReclassificationJobDocuments.sourceDocumentId, input.sourceDocumentId),
            eq(categoryReclassificationJobDocuments.claimToken, input.claimToken)
          )
        );
      return true;
    });
  },

  async renewDocumentClaim(input: {
    ledgerId: string;
    jobId: string;
    sourceDocumentId: string;
    claimToken: string;
    leaseMs: number;
    now?: Date;
  }): Promise<boolean> {
    const now = input.now ?? new Date();
    const rows = await db
      .update(categoryReclassificationJobDocuments)
      .set({
        claimExpiresAt: new Date(now.getTime() + input.leaseMs),
        heartbeatAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(categoryReclassificationJobDocuments.ledgerId, input.ledgerId),
          eq(categoryReclassificationJobDocuments.jobId, input.jobId),
          eq(categoryReclassificationJobDocuments.sourceDocumentId, input.sourceDocumentId),
          eq(categoryReclassificationJobDocuments.claimToken, input.claimToken),
          eq(categoryReclassificationJobDocuments.status, "running"),
          sql`${categoryReclassificationJobDocuments.claimExpiresAt} >= ${now}`
        )
      )
      .returning({ id: categoryReclassificationJobDocuments.sourceDocumentId });
    return rows.length === 1;
  },

  async failDocument(input: {
    ledgerId: string;
    jobId: string;
    sourceDocumentId: string;
    claimToken: string;
    errorCode: string;
    maxAttempts: number;
    retryAfterMs?: number;
    now?: Date;
  }): Promise<"lost" | "retry_scheduled" | "failed"> {
    const now = input.now ?? new Date();
    return db.transaction(async (tx) => {
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
      if (work == null || work.claimToken !== input.claimToken || work.status !== "running")
        return "lost";
      const permanent =
        work.attempts >= input.maxAttempts || input.errorCode === "ai_configuration_invalid";
      const defaultDelay = Math.min(30_000, 2_000 * 4 ** Math.max(0, work.attempts - 1));
      const retryAfterMs = Math.max(defaultDelay, input.retryAfterMs ?? 0);
      await tx
        .update(categoryReclassificationJobDocuments)
        .set({
          status: permanent ? "failed" : "pending",
          claimToken: null,
          claimExpiresAt: null,
          heartbeatAt: now,
          nextAttemptAt: new Date(now.getTime() + retryAfterMs),
          errorCode: input.errorCode,
          updatedAt: now,
        })
        .where(
          and(
            eq(categoryReclassificationJobDocuments.jobId, input.jobId),
            eq(categoryReclassificationJobDocuments.sourceDocumentId, input.sourceDocumentId)
          )
        );
      if (!permanent) return "retry_scheduled";
      await tx
        .update(categoryReclassificationJobEntries)
        .set({ outcome: "failed", errorCode: input.errorCode, updatedAt: now })
        .where(
          and(
            eq(categoryReclassificationJobEntries.jobId, input.jobId),
            eq(categoryReclassificationJobEntries.sourceDocumentId, input.sourceDocumentId),
            isNull(categoryReclassificationJobEntries.outcome)
          )
        );
      await refreshParentJob(tx, input.jobId, input.ledgerId, now);
      return "failed";
    });
  },

  async cancel(input: { ledgerId: string; jobId: string; now?: Date }): Promise<boolean> {
    const now = input.now ?? new Date();
    return db.transaction(async (tx) => {
      await lockLedgerForUpdate(tx, input.ledgerId);
      const changed = await tx
        .update(categoryReclassificationJobs)
        .set({ status: "cancelled", completedAt: now, updatedAt: now })
        .where(
          and(
            eq(categoryReclassificationJobs.id, input.jobId),
            eq(categoryReclassificationJobs.ledgerId, input.ledgerId),
            inArray(categoryReclassificationJobs.status, ["preparing", "pending", "running"])
          )
        )
        .returning({
          id: categoryReclassificationJobs.id,
          declaredEntryCount: categoryReclassificationJobs.declaredEntryCount,
          appliedCount: categoryReclassificationJobs.appliedCount,
          confirmedCount: categoryReclassificationJobs.confirmedCount,
          failedCount: categoryReclassificationJobs.failedCount,
          conflictCount: categoryReclassificationJobs.conflictCount,
          skippedCount: categoryReclassificationJobs.skippedCount,
        });
      if (changed.length === 0) return false;
      await tx
        .update(categoryReclassificationJobEntries)
        .set({ outcome: "cancelled", errorCode: null, updatedAt: now })
        .where(
          and(
            eq(categoryReclassificationJobEntries.jobId, input.jobId),
            eq(categoryReclassificationJobEntries.ledgerId, input.ledgerId),
            isNull(categoryReclassificationJobEntries.outcome)
          )
        );
      await tx
        .update(categoryReclassificationJobDocuments)
        .set({ status: "cancelled", claimToken: null, claimExpiresAt: null, updatedAt: now })
        .where(
          and(
            eq(categoryReclassificationJobDocuments.jobId, input.jobId),
            eq(categoryReclassificationJobDocuments.ledgerId, input.ledgerId),
            inArray(categoryReclassificationJobDocuments.status, ["pending", "running"])
          )
        );
      const value = await tx
        .select({ value: count() })
        .from(categoryReclassificationJobEntries)
        .where(
          and(
            eq(categoryReclassificationJobEntries.jobId, input.jobId),
            eq(categoryReclassificationJobEntries.outcome, "cancelled")
          )
        )
        .then((rows) => rows[0]?.value ?? 0);
      const job = changed[0]!;
      const classifiedCount =
        job.appliedCount +
        job.confirmedCount +
        job.failedCount +
        job.conflictCount +
        job.skippedCount;
      const cancelledCount = Math.max(Number(value), job.declaredEntryCount - classifiedCount);
      await tx
        .update(categoryReclassificationJobs)
        .set({ cancelledCount })
        .where(eq(categoryReclassificationJobs.id, input.jobId));
      return true;
    });
  },

  async retryFailures(input: {
    ledgerId: string;
    jobId: string;
    requestKey: string;
    now?: Date;
  }): Promise<{ id: string }> {
    const now = input.now ?? new Date();
    return db.transaction(async (tx) => {
      await lockLedgerForUpdate(tx, input.ledgerId);
      const replay = await tx
        .select({ id: categoryReclassificationJobs.id })
        .from(categoryReclassificationJobs)
        .where(
          and(
            eq(categoryReclassificationJobs.ledgerId, input.ledgerId),
            eq(categoryReclassificationJobs.requestKey, input.requestKey)
          )
        )
        .then((rows) => rows[0]);
      if (replay != null) return replay;
      const original = await tx
        .select()
        .from(categoryReclassificationJobs)
        .where(
          and(
            eq(categoryReclassificationJobs.ledgerId, input.ledgerId),
            eq(categoryReclassificationJobs.id, input.jobId),
            inArray(categoryReclassificationJobs.status, ["partial", "failed"])
          )
        )
        .for("update")
        .then((rows) => rows[0]);
      if (original == null || original.failedCount === 0) {
        throw new ValidationError("This assignment has no retryable failures");
      }
      const failedDocuments = await tx
        .select({ work: categoryReclassificationJobDocuments, current: sourceDocuments })
        .from(categoryReclassificationJobDocuments)
        .leftJoin(
          sourceDocuments,
          and(
            eq(sourceDocuments.ledgerId, input.ledgerId),
            eq(sourceDocuments.id, categoryReclassificationJobDocuments.sourceDocumentId)
          )
        )
        .where(
          and(
            eq(categoryReclassificationJobDocuments.ledgerId, input.ledgerId),
            eq(categoryReclassificationJobDocuments.jobId, input.jobId),
            eq(categoryReclassificationJobDocuments.status, "failed")
          )
        )
        .orderBy(categoryReclassificationJobDocuments.firstSelectionOrder);
      const failedEntries = await tx
        .select()
        .from(categoryReclassificationJobEntries)
        .where(
          and(
            eq(categoryReclassificationJobEntries.ledgerId, input.ledgerId),
            eq(categoryReclassificationJobEntries.jobId, input.jobId),
            eq(categoryReclassificationJobEntries.outcome, "failed")
          )
        )
        .orderBy(categoryReclassificationJobEntries.selectionOrder);
      const [created] = await tx
        .insert(categoryReclassificationJobs)
        .values({
          ledgerId: input.ledgerId,
          status: "pending",
          formatVersion: 2,
          mode: original.mode,
          directCategoryId: original.directCategoryId,
          candidateCategoryIds: original.candidateCategoryIds,
          candidateSnapshot: original.candidateSnapshot,
          customPromptSnapshot: original.customPromptSnapshot,
          requestKey: input.requestKey,
          parentJobId: original.id,
          declaredEntryCount: failedEntries.length,
          receivedEntryCount: failedEntries.length,
          documentTotal: failedDocuments.length,
          nextAttemptAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: categoryReclassificationJobs.id });
      if (created == null) throw new ConflictError("Retry assignment could not be created");
      const changedDocuments = new Set<string>();
      for (const { work, current } of failedDocuments) {
        const changed =
          current == null ||
          current.deletedAt != null ||
          current.version !== work.expectedVersion ||
          current.activeRevisionId !== work.revisionId;
        if (changed) changedDocuments.add(work.sourceDocumentId);
        await tx.insert(categoryReclassificationJobDocuments).values({
          jobId: created.id,
          ledgerId: input.ledgerId,
          sourceDocumentId: work.sourceDocumentId,
          expectedVersion: work.expectedVersion,
          revisionId: work.revisionId,
          firstSelectionOrder: work.firstSelectionOrder,
          status: changed ? "conflict" : "pending",
          completedChunkCount: changed ? 0 : work.completedChunkCount,
          nextAttemptAt: now,
          errorCode: changed ? "document_changed" : null,
          createdAt: now,
          updatedAt: now,
        });
      }
      for (const entry of failedEntries) {
        const changed = changedDocuments.has(entry.sourceDocumentId);
        await tx.insert(categoryReclassificationJobEntries).values({
          jobId: created.id,
          ledgerId: input.ledgerId,
          ledgerEntryId: entry.ledgerEntryId,
          sourceDocumentId: entry.sourceDocumentId,
          selectionOrder: entry.selectionOrder,
          expectedVersion: entry.expectedVersion,
          originalCategoryId: entry.originalCategoryId,
          targetCategoryId: changed ? null : entry.targetCategoryId,
          decisionPersisted: !changed && entry.decisionPersisted,
          outcome: changed ? "conflict" : null,
          errorCode: changed ? "document_changed" : null,
          createdAt: now,
          updatedAt: now,
        });
      }
      await refreshParentJob(tx, created.id, input.ledgerId, now);
      return created;
    });
  },

  async listResults(input: {
    ledgerId: string;
    jobId: string;
    cursor?: number;
    limit?: number;
  }): Promise<CategoryAssignmentResultPageDto> {
    const cursor = input.cursor ?? 0;
    const limit = Math.min(input.limit ?? 50, 50);
    const rows = await db
      .select({
        ledgerEntryId: categoryReclassificationJobEntries.ledgerEntryId,
        itemName: ledgerEntries.itemName,
        originalCategoryId: categoryReclassificationJobEntries.originalCategoryId,
        targetCategoryId: categoryReclassificationJobEntries.targetCategoryId,
        outcome: categoryReclassificationJobEntries.outcome,
        errorCode: categoryReclassificationJobEntries.errorCode,
        selectionOrder: categoryReclassificationJobEntries.selectionOrder,
      })
      .from(categoryReclassificationJobEntries)
      .leftJoin(
        ledgerEntries,
        and(
          eq(ledgerEntries.id, categoryReclassificationJobEntries.ledgerEntryId),
          eq(ledgerEntries.ledgerId, input.ledgerId)
        )
      )
      .where(
        and(
          eq(categoryReclassificationJobEntries.jobId, input.jobId),
          eq(categoryReclassificationJobEntries.ledgerId, input.ledgerId),
          sql`${categoryReclassificationJobEntries.selectionOrder} >= ${cursor}`
        )
      )
      .orderBy(categoryReclassificationJobEntries.selectionOrder)
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const categoryIds = [
      ...new Set(
        page.flatMap((row) => [row.originalCategoryId, row.targetCategoryId]).filter(Boolean)
      ),
    ] as string[];
    const categories =
      categoryIds.length === 0
        ? []
        : await db
            .select({ id: entryCategories.id, name: entryCategories.name })
            .from(entryCategories)
            .where(
              and(
                eq(entryCategories.ledgerId, input.ledgerId),
                inArray(entryCategories.id, categoryIds)
              )
            );
    const names = new Map(categories.map((category) => [category.id, category.name]));
    const items: CategoryAssignmentEntryResultDto[] = page.map((row) => ({
      ledgerEntryId: row.ledgerEntryId,
      itemName: row.itemName,
      originalCategoryId: row.originalCategoryId,
      originalCategoryName:
        row.originalCategoryId == null ? null : (names.get(row.originalCategoryId) ?? null),
      targetCategoryId: row.targetCategoryId,
      targetCategoryName:
        row.targetCategoryId == null ? null : (names.get(row.targetCategoryId) ?? null),
      outcome: row.outcome,
      errorCode: row.errorCode,
    }));
    return {
      items,
      nextCursor: rows.length > limit ? rows[limit]!.selectionOrder : null,
    };
  },
};
