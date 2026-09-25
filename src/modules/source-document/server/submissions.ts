import { and, asc, eq } from "drizzle-orm";
import "server-only";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { sourceDocumentFiles, sourceDocumentRevisions, sourceDocuments } from "@/persistence";
import {
  createProcessingRevisionInTransaction,
  type SourceDocumentContract,
  type SourceDocumentRevisionContract,
} from "@/modules/source-document/server/revisions";
import type { ProcessingJobContract } from "@/server/processing/types";
import { lockLedgerForUpdate, type PostgresTransaction } from "@/lib/db/transaction-locks";

async function submitInTransaction(
  tx: PostgresTransaction,
  input: SourceDocumentSubmissionInput,
  idempotency?: SourceDocumentIdempotencyInput
): Promise<SourceDocumentSubmissionResult> {
  let revisionInput = input.input;

  if (input.sourceDocumentId != null) {
    const document = await tx
      .select({
        inputText: sourceDocuments.inputText,
        latestSubmissionRevisionId: sourceDocuments.latestSubmissionRevisionId,
      })
      .from(sourceDocuments)
      .where(
        and(
          eq(sourceDocuments.ledgerId, input.ledgerId),
          eq(sourceDocuments.id, input.sourceDocumentId)
        )
      )
      .for("update")
      .then((rows) => rows[0]);
    if (document == null) throw new NotFoundError("Source document");
    const inputRevisionId = document.latestSubmissionRevisionId;

    if (input.inheritInput === true) {
      if (inputRevisionId == null)
        throw new ConflictError("Source document has no submission input");
      // The text and files are the document's current input; the dates the
      // parse read them with stay on the submission they came with.
      const previousInput = await tx
        .select({
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
          .select({ id: sourceDocumentFiles.storedFileId })
          .from(sourceDocumentFiles)
          .where(
            and(
              eq(sourceDocumentFiles.ledgerId, input.ledgerId),
              eq(sourceDocumentFiles.sourceDocumentId, input.sourceDocumentId)
            )
          )
          .orderBy(asc(sourceDocumentFiles.position))
      ).map((file) => file.id);
      revisionInput = { ...previousInput, text: document.inputText, storedFileIds };
    }

    if (input.supersedeProcessing === true && document?.latestSubmissionRevisionId != null) {
      await tx
        .update(sourceDocumentRevisions)
        .set({ processingStatus: "cancelled", finishedAt: new Date() })
        .where(
          and(
            eq(sourceDocumentRevisions.ledgerId, input.ledgerId),
            eq(sourceDocumentRevisions.id, document.latestSubmissionRevisionId),
            eq(sourceDocumentRevisions.processingStatus, "processing")
          )
        );
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
          ...(idempotency == null
            ? {}
            : {
                idempotency: {
                  source: idempotencySource(idempotency),
                  key: idempotency.key,
                  fingerprint: idempotency.contentFingerprint,
                },
              }),
        }
      : {
          ledgerId: input.ledgerId,
          sourceDocumentId: input.sourceDocumentId,
          input: revisionInput,
        }
  );
  // The processing attempt is its own queue entry; recovery picks it up if the
  // request that scheduled its run dies first.
  const job = {
    sourceDocumentId: pending.document.id,
    revisionId: pending.revision.id,
    requestedAt: pending.revision.submittedAt,
  };
  return { ...pending, job };
}

function idempotencySource(idempotency: SourceDocumentIdempotencyInput): string {
  return `${idempotency.principalType}:${idempotency.principalId}`;
}

/**
 * The document an earlier create request with this key made in the ledger, or
 * null. Keys never expire; one reused with other content is refused rather
 * than replayed.
 */
export async function findIdempotentSubmission(
  ledgerId: string,
  idempotency: SourceDocumentIdempotencyInput,
  executor: PostgresTransaction | typeof db = db
): Promise<SourceDocumentSubmissionContract | null> {
  const { key } = idempotency;
  if (key.trim() === "" || key.length > 512) {
    throw new ValidationError("Idempotency key must contain between 1 and 512 characters");
  }
  const document = await executor
    .select({
      id: sourceDocuments.id,
      revisionId: sourceDocuments.latestSubmissionRevisionId,
      fingerprint: sourceDocuments.idempotencyFingerprint,
    })
    .from(sourceDocuments)
    .where(
      and(
        eq(sourceDocuments.ledgerId, ledgerId),
        eq(sourceDocuments.idempotencySource, idempotencySource(idempotency)),
        eq(sourceDocuments.idempotencyKey, key)
      )
    )
    .then((rows) => rows[0]);
  if (document == null) return null;
  if (document.fingerprint !== idempotency.contentFingerprint) {
    throw new ConflictError("Idempotency key was already used with different content");
  }
  // Creating a document sets its latest submission in the same transaction.
  return {
    sourceDocumentId: document.id,
    revisionId: document.revisionId!,
    processingStatus: "processing",
  };
}

export async function submitSourceDocument(
  input: SourceDocumentSubmissionInput
): Promise<SourceDocumentSubmissionResult> {
  return db.transaction((tx) => submitInTransaction(tx, input));
}

/**
 * Creates a document that carries the request's idempotency key, or replays
 * the one an earlier request with the key created. Creations in a ledger queue
 * on its lock, so a concurrent repeat waits for the first to commit and then
 * finds its document.
 */
export async function submitSourceDocumentIdempotently(
  input: SourceDocumentSubmissionInput & { bookId: string; sourceDocumentId?: never },
  idempotency: SourceDocumentIdempotencyInput
): Promise<
  | { replayed: false; submission: SourceDocumentSubmissionResult }
  | { replayed: true; existing: SourceDocumentSubmissionContract }
> {
  return db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx, input.ledgerId);
    const existing = await findIdempotentSubmission(input.ledgerId, idempotency, tx);
    if (existing != null) return { replayed: true, existing };
    return { replayed: false, submission: await submitInTransaction(tx, input, idempotency) };
  });
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
}

/** Atomically persists submitted evidence as a processing attempt ready to be claimed. */
export type SourceDocumentSubmissionInput = {
  ledgerId: string;
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
