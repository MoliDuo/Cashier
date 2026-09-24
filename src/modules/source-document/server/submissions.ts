import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import "server-only";
import { db } from "@/lib/db";
import {
  ConflictError,
  NotFoundError,
  StaleSourceDocumentVersionError,
  ValidationError,
} from "@/lib/errors";
import {
  idempotencyRecords,
  processingOutbox,
  revisionFiles,
  sourceDocumentRevisions,
  sourceDocuments,
} from "@/persistence";
import {
  createProcessingRevisionInTransaction,
  type SourceDocumentContract,
  type SourceDocumentRevisionContract,
} from "@/modules/source-document/server/revisions";
import type { ProcessingJobContract } from "@/server/processing/types";
import type { PostgresTransaction } from "@/lib/db/transaction-locks";

const IDEMPOTENCY_WAIT_ATTEMPTS = 10;
const IDEMPOTENCY_LEASE_MS = 30_000;
const IDEMPOTENCY_RENEW_INTERVAL_MS = 10_000;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function submitInTransaction(
  tx: PostgresTransaction,
  input: SourceDocumentSubmissionInput
): Promise<SourceDocumentSubmissionResult> {
  const jobId = crypto.randomUUID();
  const requestedAt = new Date();
  let revisionInput = input.input;

  if (input.sourceDocumentId != null) {
    const document = await tx
      .select({
        activeRevisionId: sourceDocuments.activeRevisionId,
        latestSubmissionRevisionId: sourceDocuments.latestSubmissionRevisionId,
        version: sourceDocuments.version,
      })
      .from(sourceDocuments)
      .where(
        and(
          eq(sourceDocuments.ledgerId, input.ledgerId),
          eq(sourceDocuments.id, input.sourceDocumentId),
          isNull(sourceDocuments.deletedAt)
        )
      )
      .for("update")
      .then((rows) => rows[0]);
    if (document == null) throw new NotFoundError("Source document");
    if (input.expectedVersion != null && document.version !== input.expectedVersion) {
      throw new StaleSourceDocumentVersionError(
        input.sourceDocumentId,
        input.expectedVersion,
        document.version
      );
    }
    const inputRevisionId = document.latestSubmissionRevisionId;

    if (input.inheritInput === true) {
      if (inputRevisionId == null)
        throw new ConflictError("Source document has no submission input");
      const previousInput = await tx
        .select({
          text: sourceDocumentRevisions.inputText,
          documentDate: sourceDocumentRevisions.inputDocumentDate,
          dateReference: sourceDocumentRevisions.inputDateReference,
        })
        .from(sourceDocumentRevisions)
        .where(
          and(
            eq(sourceDocumentRevisions.ledgerId, input.ledgerId),
            eq(sourceDocumentRevisions.id, inputRevisionId),
            eq(sourceDocumentRevisions.sourceDocumentId, input.sourceDocumentId)
          )
        )
        .then((rows) => rows[0]);
      if (previousInput == null) throw new ConflictError("Source document has no submission input");
      const storedFileIds = (
        await tx
          .select({ id: revisionFiles.storedFileId })
          .from(revisionFiles)
          .where(
            and(
              eq(revisionFiles.ledgerId, input.ledgerId),
              eq(revisionFiles.revisionId, inputRevisionId)
            )
          )
          .orderBy(asc(revisionFiles.position))
      ).map((file) => file.id);
      revisionInput = { ...previousInput, storedFileIds };
    }

    if (input.supersedeProcessing === true && document?.latestSubmissionRevisionId != null) {
      const now = new Date();
      const supersededRevision = await tx
        .update(sourceDocumentRevisions)
        .set({
          processingStatus: "cancelled",
          finishedAt: now,
        })
        .where(
          and(
            eq(sourceDocumentRevisions.ledgerId, input.ledgerId),
            eq(sourceDocumentRevisions.id, document.latestSubmissionRevisionId),
            eq(sourceDocumentRevisions.processingStatus, "processing")
          )
        )
        .returning({ id: sourceDocumentRevisions.id })
        .then((rows) => rows[0]);

      if (supersededRevision != null) {
        await tx
          .update(processingOutbox)
          .set({
            status: "cancelled",
            diagnosticCode: "superseded_by_retry",
            completedAt: now,
            claimToken: null,
            claimExpiresAt: null,
          })
          .where(
            and(
              eq(processingOutbox.revisionId, supersededRevision.id),
              inArray(processingOutbox.status, ["pending", "claimed"])
            )
          );
      }
    }
  }

  if (revisionInput == null) throw new ValidationError("Submission input is required");
  if (
    (revisionInput.text == null || revisionInput.text.trim() === "") &&
    revisionInput.storedFileIds.length === 0
  ) {
    throw new ValidationError("Submission text and files cannot both be empty");
  }

  const pending = await createProcessingRevisionInTransaction(
    tx,
    input.sourceDocumentId == null
      ? {
          ledgerId: input.ledgerId,
          bookId: input.bookId!,
          input: revisionInput,
        }
      : {
          ledgerId: input.ledgerId,
          sourceDocumentId: input.sourceDocumentId,
          input: revisionInput,
        }
  );
  const job = {
    id: jobId,
    sourceDocumentId: pending.document.id,
    revisionId: pending.revision.id,
    requestedAt: requestedAt.toISOString(),
  };

  await tx.insert(processingOutbox).values({
    id: job.id,
    ledgerId: input.ledgerId,
    sourceDocumentId: job.sourceDocumentId,
    revisionId: pending.revision.id,
    status: "pending",
    requestedAt,
  });

  return { ...pending, job };
}

async function createIdempotentSubmission(
  idempotency: SourceDocumentIdempotencyInput,
  prepare: () => Promise<SourceDocumentSubmissionInput>
): Promise<SourceDocumentSubmissionResult> {
  const { principalType, principalId, key, contentFingerprint } = idempotency;
  if (key.trim() === "" || key.length > 512) {
    throw new ValidationError("Idempotency key must contain between 1 and 512 characters");
  }

  const now = new Date();
  const leaseToken = crypto.randomUUID();
  const claimed = await db
    .insert(idempotencyRecords)
    .values({
      principalType,
      principalId,
      key,
      status: "pending",
      contentFingerprint,
      leaseToken,
      leaseExpiresAt: new Date(now.getTime() + IDEMPOTENCY_LEASE_MS),
      expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
    })
    .onConflictDoUpdate({
      target: [
        idempotencyRecords.principalType,
        idempotencyRecords.principalId,
        idempotencyRecords.key,
      ],
      set: {
        leaseToken,
        leaseExpiresAt: new Date(now.getTime() + IDEMPOTENCY_LEASE_MS),
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
      },
      setWhere: sql`${idempotencyRecords.status} = 'pending'
        AND ${idempotencyRecords.leaseExpiresAt} < ${now}
        AND ${idempotencyRecords.contentFingerprint} IS NOT DISTINCT FROM ${contentFingerprint}`,
    })
    .returning({ key: idempotencyRecords.key });

  if (claimed.length === 1) {
    const renewLease = async () => {
      const renewedAt = new Date();
      await db
        .update(idempotencyRecords)
        .set({ leaseExpiresAt: new Date(renewedAt.getTime() + IDEMPOTENCY_LEASE_MS) })
        .where(
          and(
            eq(idempotencyRecords.principalType, principalType),
            eq(idempotencyRecords.principalId, principalId),
            eq(idempotencyRecords.key, key),
            eq(idempotencyRecords.status, "pending"),
            eq(idempotencyRecords.leaseToken, leaseToken)
          )
        );
    };
    const heartbeat = setInterval(() => {
      void renewLease().catch(() => {
        // The final fencing-token update remains authoritative if renewal fails.
      });
    }, IDEMPOTENCY_RENEW_INTERVAL_MS);
    try {
      const input = await prepare();
      return await db.transaction(async (tx) => {
        const submission = await submitInTransaction(tx, input);
        const committed = await tx
          .update(idempotencyRecords)
          .set({
            status: "completed",
            result: { value: submission },
            completedAt: new Date(),
            leaseToken: null,
            leaseExpiresAt: null,
          })
          .where(
            and(
              eq(idempotencyRecords.principalType, principalType),
              eq(idempotencyRecords.principalId, principalId),
              eq(idempotencyRecords.key, key),
              eq(idempotencyRecords.leaseToken, leaseToken)
            )
          )
          .returning({ key: idempotencyRecords.key });
        if (committed.length !== 1) {
          throw new ConflictError("The idempotency lease expired before submission commit");
        }
        return submission;
      });
    } catch (error) {
      await db
        .delete(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.principalType, principalType),
            eq(idempotencyRecords.principalId, principalId),
            eq(idempotencyRecords.key, key),
            eq(idempotencyRecords.leaseToken, leaseToken)
          )
        );
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  }

  for (let attempt = 0; attempt < IDEMPOTENCY_WAIT_ATTEMPTS; attempt += 1) {
    const record = await db.query.idempotencyRecords.findFirst({
      where: and(
        eq(idempotencyRecords.principalType, principalType),
        eq(idempotencyRecords.principalId, principalId),
        eq(idempotencyRecords.key, key)
      ),
    });
    if (record != null && record.contentFingerprint !== contentFingerprint) {
      throw new ConflictError("Idempotency key was already used with different content");
    }
    if (record?.status === "completed") {
      const submission = (record.result as { value: SourceDocumentSubmissionResult }).value;
      return { ...submission, idempotencyReplay: true };
    }
    if (record == null || (record.leaseExpiresAt != null && record.leaseExpiresAt <= new Date())) {
      return createIdempotentSubmission(idempotency, prepare);
    }
    await wait(Math.min(25 * 2 ** attempt, 500));
  }
  throw new ConflictError("The idempotent request is still in progress");
}

export async function submitSourceDocument(
  input: SourceDocumentSubmissionInput
): Promise<SourceDocumentSubmissionResult> {
  return db.transaction((tx) => submitInTransaction(tx, input));
}

export async function submitSourceDocumentIdempotently(
  idempotency: SourceDocumentIdempotencyInput,
  prepare: () => Promise<SourceDocumentSubmissionInput>
): Promise<SourceDocumentSubmissionResult> {
  return createIdempotentSubmission(idempotency, prepare);
}

export interface SourceDocumentSubmissionContract {
  sourceDocumentId: string;
  revisionId: string;
  processingStatus: "processing";
}

export interface SourceDocumentSubmissionResult {
  document: SourceDocumentContract;
  revision: SourceDocumentRevisionContract;
  job: ProcessingJobContract;
  /** True when the result was replayed from an already-completed idempotent request. */
  idempotencyReplay?: boolean;
}

/** Atomically persists submitted evidence and the durable work needed to process it. */
export type SourceDocumentSubmissionInput = {
  ledgerId: string;
  expectedVersion?: number;
  input?: SourceDocumentInputContract;
  inheritInput?: boolean;
  supersedeProcessing?: boolean;
} & ({ sourceDocumentId: string; bookId?: string } | { sourceDocumentId?: never; bookId: string });

export interface SourceDocumentInputContract {
  text: string | null;
  storedFileIds: readonly string[];
  documentDate: string | null;
  dateReference?: string | null;
}

export interface SourceDocumentIdempotencyInput {
  principalType: "credential" | "user";
  principalId: string;
  key: string;
  contentFingerprint: string | null;
}
