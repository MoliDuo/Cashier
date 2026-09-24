import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { books, ledgers, sourceDocuments } from "@/persistence";
import { NotFoundError, ValidationError } from "@/lib/errors";

/** Drizzle transaction client type shared by every transactional server function. */
export type PostgresTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Lock order convention:
 *   ledger → source document
 *
 * When a transaction must lock both rows, always lock the ledger row first to prevent deadlocks.
 * Use these helpers inside existing Drizzle transactions — they issue `SELECT ... FOR UPDATE`
 * which holds the row lock until the enclosing transaction commits or rolls back.
 */

/**
 * Acquire a FOR UPDATE row lock on the target ledger row.
 * Returns the locked row so callers can read metadata without an extra round-trip.
 * Throws {@link NotFoundError} when the ledger does not exist or is soft-deleted.
 */
export async function lockLedgerForUpdate(
  tx: PostgresTransaction,
  ledgerId: string
): Promise<typeof ledgers.$inferSelect> {
  const rows = await tx.select().from(ledgers).where(eq(ledgers.id, ledgerId)).for("update");

  if (rows.length === 0) {
    throw new NotFoundError("Ledger");
  }

  return rows[0]!;
}

/**
 * Re-read the book a record is being filed into under a `FOR SHARE` lock, so
 * the write transaction sees a stable answer: a concurrent archive holds the
 * ledger row (locked first by the caller) while it works, so this either runs
 * before it and sees a live book, or after it and refuses. A shared lock is
 * enough — the caller only needs the row not to change underneath, not to edit
 * it — and lets two records into the same book commit in parallel.
 * Throws {@link NotFoundError} when the book does not exist, belongs to another
 * ledger, or was archived before this transaction took the ledger lock.
 */
export async function lockBookForShare(
  tx: PostgresTransaction,
  ledgerId: string,
  bookId: string
): Promise<typeof books.$inferSelect> {
  const rows = await tx
    .select()
    .from(books)
    .where(and(eq(books.ledgerId, ledgerId), eq(books.id, bookId), isNull(books.archivedAt)))
    .for("share");

  if (rows.length === 0) {
    throw new NotFoundError("Book");
  }

  return rows[0]!;
}

/**
 * Acquire a FOR UPDATE row lock on the target source document row.
 * Returns the locked row so callers can re-read pointers without an extra round-trip.
 * Throws {@link NotFoundError} when the document does not exist or is soft-deleted.
 */
export async function lockSourceDocumentForUpdate(
  tx: PostgresTransaction,
  ledgerId: string,
  sourceDocumentId: string
): Promise<typeof sourceDocuments.$inferSelect> {
  const rows = await tx
    .select()
    .from(sourceDocuments)
    .where(
      and(
        eq(sourceDocuments.ledgerId, ledgerId),
        eq(sourceDocuments.id, sourceDocumentId),
        isNull(sourceDocuments.deletedAt)
      )
    )
    .for("update");

  if (rows.length === 0) {
    throw new NotFoundError("Source document");
  }

  return rows[0]!;
}

/**
 * Acquire `FOR UPDATE` row locks on multiple source-document rows in a single
 * query, always in ascending ID order — the fixed order is what prevents
 * deadlocks when several transactions lock overlapping document sets.
 * Throws {@link ValidationError} for a duplicate ID (a programming error: no
 * caller ever legitimately targets the same document twice in one command)
 * and {@link NotFoundError} when any requested document does not exist, is
 * soft-deleted, or does not belong to `ledgerId`.
 */
export async function lockSourceDocumentsForUpdate(
  tx: PostgresTransaction,
  ledgerId: string,
  sourceDocumentIds: readonly string[]
): Promise<Array<typeof sourceDocuments.$inferSelect>> {
  const uniqueIds = new Set(sourceDocumentIds);
  if (uniqueIds.size !== sourceDocumentIds.length) {
    throw new ValidationError("A source document may only be locked once per command");
  }
  const orderedIds = [...uniqueIds].sort();

  const rows = await tx
    .select()
    .from(sourceDocuments)
    .where(
      and(
        eq(sourceDocuments.ledgerId, ledgerId),
        inArray(sourceDocuments.id, orderedIds),
        isNull(sourceDocuments.deletedAt)
      )
    )
    .orderBy(asc(sourceDocuments.id))
    .for("update");

  if (rows.length !== orderedIds.length) {
    throw new NotFoundError("Source document");
  }

  return rows;
}
