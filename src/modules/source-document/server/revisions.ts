import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import "server-only";
import type {
  RevisionFailureKind,
  RevisionProcessingStatus,
  SupportedSourceDocumentAction,
} from "@/modules/source-document/lifecycle";
import type { ProcessingLeaseContract } from "@/server/processing/types";
import { deriveSourceDocumentCapabilities } from "@/modules/source-document/domain/source-document-state";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { MAX_FILES, MAX_NORMALIZED_BYTES_PER_REVISION } from "@/lib/storage/upload-policy";
import {
  ledgers,
  revisionFiles,
  sourceDocumentRevisions,
  sourceDocuments,
  storedFiles,
} from "@/persistence";
import {
  lockBookForShare,
  lockLedgerForUpdate,
  lockSourceDocumentForUpdate,
} from "@/lib/db/transaction-locks";
import type { PostgresTransaction } from "@/lib/db/transaction-locks";
import { completeProcessingLeaseInTransaction } from "@/server/processing/terminal";
import { copyRevisionInputToDocument } from "./document-input";

export type CreatePendingRevisionInput = {
  ledgerId: string;
  input: {
    text: string | null;
    storedFileIds: readonly string[];
    documentDate: string | null;
    dateReference?: string | null;
  };
} & ({ sourceDocumentId: string; bookId?: string } | { sourceDocumentId?: never; bookId: string });

function activeDocumentWhere(ledgerId: string, sourceDocumentId: string) {
  return and(
    eq(sourceDocuments.ledgerId, ledgerId),
    eq(sourceDocuments.id, sourceDocumentId),
    isNull(sourceDocuments.deletedAt)
  )!;
}

function mapRevision(
  row: typeof sourceDocumentRevisions.$inferSelect
): SourceDocumentRevisionContract {
  return {
    id: row.id,
    sourceDocumentId: row.sourceDocumentId,
    processingStatus: row.processingStatus,
    submittedAt: row.submittedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

function mapDocument(
  row: typeof sourceDocuments.$inferSelect,
  latestSubmissionStatus: RevisionProcessingStatus | null
): SourceDocumentContract {
  return {
    id: row.id,
    ledgerId: row.ledgerId,
    version: row.version,
    activeRevisionId: row.activeRevisionId,
    latestSubmissionRevisionId: row.latestSubmissionRevisionId,
    supportedActions:
      row.deletedAt == null
        ? deriveSourceDocumentCapabilities({
            activeRevisionId: row.activeRevisionId,
            latestSubmissionStatus,
            hasSubmissionInput: row.latestSubmissionRevisionId != null,
          }).supportedActions
        : [],
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
  input: CreatePendingRevisionInput,
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
    })
    .returning();
  return rows[0]!;
}

export async function createProcessingRevisionInTransaction(
  tx: PostgresTransaction,
  input: CreatePendingRevisionInput
): Promise<{ document: SourceDocumentContract; revision: SourceDocumentRevisionContract }> {
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

  if (document.latestSubmissionRevisionId != null) {
    const currentPending = await tx
      .select({ processingStatus: sourceDocumentRevisions.processingStatus })
      .from(sourceDocumentRevisions)
      .where(
        and(
          eq(sourceDocumentRevisions.ledgerId, input.ledgerId),
          eq(sourceDocumentRevisions.id, document.latestSubmissionRevisionId),
          eq(sourceDocumentRevisions.sourceDocumentId, sourceDocumentId)
        )
      )
      .then((rows) => rows[0]);
    if (currentPending?.processingStatus === "processing") {
      throw new ConflictError("Source document is already processing a submission");
    }
  }

  const revision = await tx
    .insert(sourceDocumentRevisions)
    .values({
      ledgerId: input.ledgerId,
      sourceDocumentId,
      inputText: input.input.text,
      inputDocumentDate: input.input.documentDate,
      inputDateReference: input.input.dateReference ?? input.input.documentDate,
      processingStatus: "processing",
    })
    .returning()
    .then((rows) => rows[0]);
  if (revision == null) throw new ConflictError("Failed to create source document revision");

  const fileIds = [...new Set(input.input.storedFileIds)];
  if (fileIds.length !== input.input.storedFileIds.length) {
    throw new ValidationError("A stored file may only appear once in a revision");
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
              isNull(storedFiles.deletedAt),
              isNotNull(storedFiles.finalizedAt)
            )
          );
  if (foundStoredFiles.length !== fileIds.length) throw new NotFoundError("Stored file");
  const storedFileById = new Map(foundStoredFiles.map((file) => [file.id, file]));
  const storedFileRows = fileIds.map((id) => storedFileById.get(id)!);
  // Enforce per-revision byte aggregate limit
  const totalBytes = storedFileRows.reduce((sum, f) => sum + f.byteSize, 0);
  if (totalBytes > MAX_NORMALIZED_BYTES_PER_REVISION) {
    throw new ValidationError(
      `Total stored bytes ${totalBytes} exceeds revision limit of ${MAX_NORMALIZED_BYTES_PER_REVISION}`
    );
  }

  // Enforce per-revision file count limit (authoritative boundary).
  // fileIds is already deduplicated above, so this checks the final unique count.
  if (fileIds.length > MAX_FILES) {
    throw new ValidationError(
      `Total file count ${fileIds.length} exceeds revision limit of ${MAX_FILES}`
    );
  }

  // Ownership checks completed above; the file rows are inserted in one batch.
  if (storedFileRows.length > 0) {
    await tx.insert(revisionFiles).values(
      storedFileRows.map((file, position) => ({
        ledgerId: input.ledgerId,
        revisionId: revision.id,
        storedFileId: file.id,
        position,
      }))
    );
  }

  const updatedDocument = await tx
    .update(sourceDocuments)
    .set({
      latestSubmissionRevisionId: revision.id,
      updatedAt: new Date(),
    })
    .where(activeDocumentWhere(input.ledgerId, sourceDocumentId))
    .returning()
    .then((rows) => rows[0]);
  if (updatedDocument == null)
    throw new ConflictError("Failed to update source document revision pointer");
  await copyRevisionInputToDocument(tx, {
    ledgerId: input.ledgerId,
    sourceDocumentId,
    revisionId: revision.id,
  });
  return { document: mapDocument(updatedDocument, "processing"), revision: mapRevision(revision) };
}

export interface RecordProcessingFailureInput {
  ledgerId: string;
  sourceDocumentId: string;
  revisionId: string;
  failureKind: RevisionFailureKind;
  /**
   * User-facing text. `null` when the failure carries no explanation, in
   * which case the UI falls back to localized copy.
   */
  failureMessage: string | null;
  failureCode?: string | null;
  lease: ProcessingLeaseContract;
}

/**
 * Marks the latest submission as failed and closes its outbox lease. Returns
 * false when the lease was lost or the revision was superseded, so a late
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
    if (document.latestSubmissionRevisionId !== input.revisionId) return false;
    const revision = await tx
      .select({ processingStatus: sourceDocumentRevisions.processingStatus })
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
    if (revision?.processingStatus !== "processing") return false;
    if (
      !(await completeProcessingLeaseInTransaction(tx, input.lease, "failed", {
        code: input.failureCode ?? null,
      }))
    ) {
      return false;
    }
    const updated = await tx
      .update(sourceDocumentRevisions)
      .set({
        processingStatus: "failed",
        failureKind: input.failureKind,
        failureMessage: input.failureMessage,
        failureCode: input.failureCode ?? null,
        finishedAt: new Date(),
      })
      .where(
        and(
          eq(sourceDocumentRevisions.ledgerId, input.ledgerId),
          eq(sourceDocumentRevisions.sourceDocumentId, input.sourceDocumentId),
          eq(sourceDocumentRevisions.id, input.revisionId),
          eq(sourceDocumentRevisions.processingStatus, "processing")
        )
      )
      .returning({ id: sourceDocumentRevisions.id });
    if (updated.length === 0) return false;
    await tx
      .update(sourceDocuments)
      .set({ updatedAt: new Date() })
      .where(
        and(
          activeDocumentWhere(input.ledgerId, input.sourceDocumentId),
          eq(sourceDocuments.latestSubmissionRevisionId, input.revisionId)
        )
      );
    return true;
  });
}

export interface SourceDocumentContract {
  id: string;
  ledgerId: string;
  version: number;
  activeRevisionId: string | null;
  latestSubmissionRevisionId: string | null;
  supportedActions: readonly SupportedSourceDocumentAction[];
}

export interface SourceDocumentRevisionContract {
  id: string;
  sourceDocumentId: string;
  processingStatus: RevisionProcessingStatus | null;
  submittedAt: string;
  finishedAt: string | null;
}
