import { and, eq, inArray, isNotNull } from "drizzle-orm";
import "server-only";
import type {
  AttemptFailureKind,
  AttemptProcessingStatus,
  SupportedSourceDocumentAction,
} from "@/modules/source-document/lifecycle";
import type { ProcessingLeaseContract } from "@/server/processing/types";
import { deriveSourceDocumentCapabilities } from "@/modules/source-document/domain/source-document-state";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { MAX_FILES, MAX_NORMALIZED_BYTES_PER_ATTEMPT } from "@/lib/storage/upload-policy";
import { ledgers, extractionAttempts, sourceDocuments, storedFiles } from "@/persistence";
import {
  lockBookForShare,
  lockLedgerForUpdate,
  lockSourceDocumentForUpdate,
} from "@/lib/db/transaction-locks";
import type { PostgresTransaction } from "@/lib/db/transaction-locks";
import { closeProcessingLeaseInTransaction } from "@/server/processing/terminal";
import { replaceDocumentInput } from "./document-input";

export type CreatePendingAttemptInput = {
  ledgerId: string;
  input: {
    text: string | null;
    storedFileIds: readonly string[];
    documentDate: string | null;
    dateReference?: string | null;
  };
  /** Recorded on a new document so a repeated create request finds it. */
  idempotency?: { source: string; key: string; fingerprint: string | null };
} & ({ sourceDocumentId: string; bookId?: string } | { sourceDocumentId?: never; bookId: string });

function activeDocumentWhere(ledgerId: string, sourceDocumentId: string) {
  return and(eq(sourceDocuments.ledgerId, ledgerId), eq(sourceDocuments.id, sourceDocumentId))!;
}

function mapAttempt(row: typeof extractionAttempts.$inferSelect): SourceDocumentAttemptContract {
  return {
    id: row.id,
    sourceDocumentId: row.sourceDocumentId,
    processingStatus: row.status,
    submittedAt: row.submittedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

function mapDocument(
  row: typeof sourceDocuments.$inferSelect,
  latestAttemptStatus: AttemptProcessingStatus | null
): SourceDocumentContract {
  return {
    id: row.id,
    ledgerId: row.ledgerId,
    version: row.version,
    latestAttemptId: row.latestAttemptId,
    supportedActions: deriveSourceDocumentCapabilities({
      latestAttemptStatus,
      hasSubmissionInput: row.latestAttemptId != null,
    }).supportedActions,
  };
}

/**
 * Insert the source document a new submission starts, under the locks that
 * make the ledger and the target book's liveness final for this transaction.
 *
 * The checks the caller already ran happened outside any lock, so an archive or
 * a ledger delete can commit between them and the insert. Lock the ledger first
 * and then the book — the documented ledger → book order — so the insert either
 * sees both live or refuses with its own error.
 */
async function insertNewSourceDocument(
  tx: PostgresTransaction,
  input: CreatePendingAttemptInput,
  sourceDocumentId: string
): Promise<typeof sourceDocuments.$inferSelect> {
  await lockLedgerForUpdate(tx, input.ledgerId);
  await lockBookForShare(tx, input.ledgerId, input.bookId!);
  const rows = await tx
    .insert(sourceDocuments)
    .values({
      id: sourceDocumentId,
      ledgerId: input.ledgerId,
      bookId: input.bookId!,
      idempotencySource: input.idempotency?.source ?? null,
      idempotencyKey: input.idempotency?.key ?? null,
      idempotencyFingerprint: input.idempotency?.fingerprint ?? null,
    })
    .returning();
  return rows[0]!;
}

export async function createProcessingAttemptInTransaction(
  tx: PostgresTransaction,
  input: CreatePendingAttemptInput
): Promise<{ document: SourceDocumentContract; attempt: SourceDocumentAttemptContract }> {
  const ledger = await tx
    .select({ id: ledgers.id })
    .from(ledgers)
    .where(eq(ledgers.id, input.ledgerId))
    .then((rows) => rows[0]);
  if (ledger == null) throw new NotFoundError("Ledger");

  const sourceDocumentId = input.sourceDocumentId ?? crypto.randomUUID();
  const existingDocument = await tx
    .select()
    .from(sourceDocuments)
    .where(activeDocumentWhere(input.ledgerId, sourceDocumentId))
    .then((rows) => rows[0]);

  if (existingDocument == null && input.sourceDocumentId != null) {
    throw new NotFoundError("Source document");
  }
  if (existingDocument == null && input.bookId == null) {
    throw new ValidationError("A book is required for a new record");
  }

  // Acquire a lock on existing documents or create a new one.
  const document =
    existingDocument == null
      ? await insertNewSourceDocument(tx, input, sourceDocumentId)
      : await lockSourceDocumentForUpdate(tx, input.ledgerId, sourceDocumentId);

  if (document.latestAttemptId != null) {
    const currentPending = await tx
      .select({ status: extractionAttempts.status })
      .from(extractionAttempts)
      .where(
        and(
          eq(extractionAttempts.ledgerId, input.ledgerId),
          eq(extractionAttempts.id, document.latestAttemptId),
          eq(extractionAttempts.sourceDocumentId, sourceDocumentId)
        )
      )
      .then((rows) => rows[0]);
    if (currentPending?.status === "processing") {
      throw new ConflictError("Source document is already processing a submission");
    }
  }

  const attempt = await tx
    .insert(extractionAttempts)
    .values({
      ledgerId: input.ledgerId,
      sourceDocumentId,
      requestedDate: input.input.documentDate,
      referenceDate: input.input.dateReference ?? input.input.documentDate,
      status: "processing",
    })
    .returning()
    .then((rows) => rows[0]);
  if (attempt == null) throw new ConflictError("Failed to create source document attempt");

  const fileIds = [...new Set(input.input.storedFileIds)];
  if (fileIds.length !== input.input.storedFileIds.length) {
    throw new ValidationError("A stored file may only appear once in a attempt");
  }
  const foundStoredFiles =
    fileIds.length === 0
      ? []
      : await tx
          .select({ id: storedFiles.id, byteSize: storedFiles.byteSize })
          .from(storedFiles)
          .where(
            and(
              eq(storedFiles.ledgerId, input.ledgerId),
              inArray(storedFiles.id, fileIds),
              isNotNull(storedFiles.finalizedAt)
            )
          );
  if (foundStoredFiles.length !== fileIds.length) throw new NotFoundError("Stored file");
  const storedFileById = new Map(foundStoredFiles.map((file) => [file.id, file]));
  const storedFileRows = fileIds.map((id) => storedFileById.get(id)!);
  // Enforce per-attempt byte aggregate limit
  const totalBytes = storedFileRows.reduce((sum, f) => sum + f.byteSize, 0);
  if (totalBytes > MAX_NORMALIZED_BYTES_PER_ATTEMPT) {
    throw new ValidationError(
      `Total stored bytes ${totalBytes} exceeds attempt limit of ${MAX_NORMALIZED_BYTES_PER_ATTEMPT}`
    );
  }

  // Enforce per-attempt file count limit (authoritative boundary).
  // fileIds is already deduplicated above, so this checks the final unique count.
  if (fileIds.length > MAX_FILES) {
    throw new ValidationError(
      `Total file count ${fileIds.length} exceeds attempt limit of ${MAX_FILES}`
    );
  }

  const updatedDocument = await tx
    .update(sourceDocuments)
    .set({
      latestAttemptId: attempt.id,
      updatedAt: new Date(),
    })
    .where(activeDocumentWhere(input.ledgerId, sourceDocumentId))
    .returning()
    .then((rows) => rows[0]);
  if (updatedDocument == null)
    throw new ConflictError("Failed to update source document attempt pointer");
  // The submission's input becomes the document's, even while the entries of
  // an earlier parse stay until this attempt completes.
  await replaceDocumentInput(tx, {
    ledgerId: input.ledgerId,
    sourceDocumentId,
    text: input.input.text,
    storedFileIds: fileIds,
  });
  return { document: mapDocument(updatedDocument, "processing"), attempt: mapAttempt(attempt) };
}

export interface RecordProcessingFailureInput {
  ledgerId: string;
  sourceDocumentId: string;
  attemptId: string;
  failureKind: AttemptFailureKind;
  /**
   * User-facing text. `null` when the failure carries no explanation, in
   * which case the UI falls back to localized copy.
   */
  failureMessage: string | null;
  failureCode?: string | null;
  lease: ProcessingLeaseContract;
}

/**
 * Marks the latest submission as failed and releases its lease. Returns
 * false when the lease was lost or the attempt was superseded, so a late
 * worker never overwrites newer state.
 */
export async function recordProcessingFailure(
  input: RecordProcessingFailureInput
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx, input.ledgerId);
    let document;
    try {
      document = await lockSourceDocumentForUpdate(tx, input.ledgerId, input.sourceDocumentId);
    } catch (error) {
      if (error instanceof NotFoundError) return false;
      throw error;
    }
    if (document.latestAttemptId !== input.attemptId) return false;
    const attempt = await tx
      .select({ status: extractionAttempts.status })
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
    if (attempt?.status !== "processing") return false;
    if (!(await closeProcessingLeaseInTransaction(tx, input.lease))) return false;
    const updated = await tx
      .update(extractionAttempts)
      .set({
        status: "failed",
        failureKind: input.failureKind,
        failureMessage: input.failureMessage,
        failureCode: input.failureCode ?? null,
        finishedAt: new Date(),
      })
      .where(
        and(
          eq(extractionAttempts.ledgerId, input.ledgerId),
          eq(extractionAttempts.sourceDocumentId, input.sourceDocumentId),
          eq(extractionAttempts.id, input.attemptId),
          eq(extractionAttempts.status, "processing")
        )
      )
      .returning({ id: extractionAttempts.id });
    if (updated.length === 0) return false;
    await tx
      .update(sourceDocuments)
      .set({ updatedAt: new Date() })
      .where(
        and(
          activeDocumentWhere(input.ledgerId, input.sourceDocumentId),
          eq(sourceDocuments.latestAttemptId, input.attemptId)
        )
      );
    return true;
  });
}

export interface SourceDocumentContract {
  id: string;
  ledgerId: string;
  version: number;
  latestAttemptId: string | null;
  supportedActions: readonly SupportedSourceDocumentAction[];
}

export interface SourceDocumentAttemptContract {
  id: string;
  sourceDocumentId: string;
  processingStatus: AttemptProcessingStatus | null;
  submittedAt: string;
  finishedAt: string | null;
}
