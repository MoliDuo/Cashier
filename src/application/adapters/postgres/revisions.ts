import { and, desc, eq, inArray, isNotNull, isNull, lt, max, or, sql } from "drizzle-orm";
import type {
  RevisionProcessingStatus,
  SourceDocumentContract,
  SourceDocumentPort,
  SourceDocumentRevisionContract,
} from "@/application/contracts";
import { deriveSourceDocumentCapabilities } from "@/modules/source-document/application/source-document-state";
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
} from "./transaction-locks";
import type { PostgresTransaction } from "./transaction-locks";
import { completeProcessingLeaseInTransaction } from "./processing-terminal";
import { softDeleteSourceDocumentInTransaction } from "./source-document-delete";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

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
    origin: row.origin,
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

function encodeCursor(row: typeof sourceDocuments.$inferSelect): string {
  return Buffer.from(JSON.stringify([row.createdAt.getTime(), row.id])).toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== "number" ||
      typeof parsed[1] !== "string"
    ) {
      throw new Error("invalid cursor");
    }
    return { createdAt: new Date(parsed[0]), id: parsed[1] };
  } catch {
    throw new ValidationError("Invalid source document cursor");
  }
}

async function latestSubmissionStatuses(rows: readonly (typeof sourceDocuments.$inferSelect)[]) {
  const result = new Map<string, RevisionProcessingStatus>();
  const latestSubmissionRevisionIds = rows.flatMap((row) =>
    row.latestSubmissionRevisionId == null ? [] : [row.latestSubmissionRevisionId]
  );
  if (latestSubmissionRevisionIds.length === 0) return result;

  const revisions = await db
    .select({
      id: sourceDocumentRevisions.id,
      sourceDocumentId: sourceDocumentRevisions.sourceDocumentId,
      processingStatus: sourceDocumentRevisions.processingStatus,
    })
    .from(sourceDocumentRevisions)
    .where(inArray(sourceDocumentRevisions.id, latestSubmissionRevisionIds));
  const expectedRevisionByDocument = new Map(
    rows.flatMap((row) =>
      row.latestSubmissionRevisionId == null
        ? []
        : [[row.id, row.latestSubmissionRevisionId] as const]
    )
  );
  for (const revision of revisions) {
    if (expectedRevisionByDocument.get(revision.sourceDocumentId) === revision.id) {
      result.set(revision.sourceDocumentId, revision.processingStatus as RevisionProcessingStatus);
    }
  }
  return result;
}

/**
 * Insert the source document a new submission starts, under the locks that
 * make the ledger and the target book's liveness final for this transaction.
 *
 * The checks the caller already ran happened outside any lock, so an archive or
 * a ledger delete can commit between them and the insert. Lock the ledger first
 * and then the book — the documented ledger → book order — so the insert either
 * sees both live or refuses with the port's own error.
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
    .where(and(eq(ledgers.id, input.ledgerId), isNull(ledgers.deletedAt)))
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

  const aggregate = await tx
    .select({ value: max(sourceDocumentRevisions.revisionNumber) })
    .from(sourceDocumentRevisions)
    .where(eq(sourceDocumentRevisions.sourceDocumentId, sourceDocumentId))
    .then((rows) => rows[0]);
  const revision = await tx
    .insert(sourceDocumentRevisions)
    .values({
      ledgerId: input.ledgerId,
      sourceDocumentId,
      revisionNumber: (aggregate?.value ?? 0) + 1,
      origin: "submission",
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
      ...(existingDocument == null ? {} : { version: sql`${sourceDocuments.version} + 1` }),
      updatedAt: new Date(),
    })
    .where(activeDocumentWhere(input.ledgerId, sourceDocumentId))
    .returning()
    .then((rows) => rows[0]);
  if (updatedDocument == null)
    throw new ConflictError("Failed to update source document revision pointer");
  return { document: mapDocument(updatedDocument, "processing"), revision: mapRevision(revision) };
}

export const postgresRevisionAdapter: SourceDocumentPort = {
  async get(ledgerId, id) {
    const document = await db.query.sourceDocuments.findFirst({
      where: activeDocumentWhere(ledgerId, id),
    });
    if (document == null) return null;
    const outcomes = await latestSubmissionStatuses([document]);
    return mapDocument(document, outcomes.get(document.id) ?? null);
  },

  async list({ ledgerId, cursor, limit = DEFAULT_PAGE_SIZE }) {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE_SIZE);
    const decoded = cursor == null ? null : decodeCursor(cursor);
    const cursorCondition =
      decoded == null
        ? undefined
        : or(
            lt(sourceDocuments.createdAt, decoded.createdAt),
            and(
              eq(sourceDocuments.createdAt, decoded.createdAt),
              lt(sourceDocuments.id, decoded.id)
            )
          );
    const rows = await db
      .select()
      .from(sourceDocuments)
      .where(
        and(
          eq(sourceDocuments.ledgerId, ledgerId),
          isNull(sourceDocuments.deletedAt),
          cursorCondition
        )
      )
      .orderBy(desc(sourceDocuments.createdAt), desc(sourceDocuments.id))
      .limit(boundedLimit + 1);
    const hasNext = rows.length > boundedLimit;
    const pageRows = hasNext ? rows.slice(0, boundedLimit) : rows;
    const outcomes = await latestSubmissionStatuses(pageRows);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((row) => mapDocument(row, outcomes.get(row.id) ?? null)),
      nextCursor: hasNext && last != null ? encodeCursor(last) : null,
    };
  },

  async createProcessingRevision(input) {
    return db.transaction(async (tx) => createProcessingRevisionInTransaction(tx, input));
  },

  async markProcessing(input) {
    return db.transaction(async (tx) => {
      let document;
      try {
        document = await lockSourceDocumentForUpdate(tx, input.ledgerId, input.sourceDocumentId);
      } catch (error) {
        if (error instanceof NotFoundError) return false;
        throw error;
      }
      if (document.latestSubmissionRevisionId !== input.revisionId) return false;
      const updated = await tx
        .update(sourceDocumentRevisions)
        .set({ processingStatus: "processing" })
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
      return true;
    });
  },

  async recordProcessingFailure(input) {
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
        .set({
          version: sql`${sourceDocuments.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            activeDocumentWhere(input.ledgerId, input.sourceDocumentId),
            eq(sourceDocuments.latestSubmissionRevisionId, input.revisionId)
          )
        );
      return true;
    });
  },

  async softDelete(ledgerId, sourceDocumentId) {
    return db.transaction((tx) =>
      softDeleteSourceDocumentInTransaction(tx, ledgerId, sourceDocumentId)
    );
  },
};
