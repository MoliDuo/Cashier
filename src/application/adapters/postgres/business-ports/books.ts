import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { BookContract, BookPort } from "@/application/contracts";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { books, serviceCredentials, sourceDocuments } from "@/persistence";

type BookRow = typeof books.$inferSelect;

function toBook(row: BookRow): BookContract {
  return {
    id: row.id,
    ledgerId: row.ledgerId,
    name: row.name,
    timeZone: row.timeZone,
    sortOrder: row.sortOrder,
    isDefault: row.isDefault,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

function liveBooksWhere(ledgerId: string) {
  return and(eq(books.ledgerId, ledgerId), isNull(books.archivedAt))!;
}

function duplicateNameError() {
  return new ConflictError("A book with that name already exists");
}

/**
 * The books that are still in use. A retired book may share a name with a live
 * one and may keep a stale default flag, so the counts that decide what is
 * allowed always ask about the live rows only.
 */
async function countLiveBooks(tx: Pick<typeof db, "select">, ledgerId: string): Promise<number> {
  const rows = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(books)
    .where(liveBooksWhere(ledgerId));
  return Number(rows[0]?.count ?? 0);
}

/** Whether any API key — revoked ones included — still points at the book. */
async function countCredentials(
  tx: Pick<typeof db, "select">,
  ledgerId: string,
  bookId: string
): Promise<number> {
  const rows = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(serviceCredentials)
    .where(and(eq(serviceCredentials.ledgerId, ledgerId), eq(serviceCredentials.bookId, bookId)));
  return Number(rows[0]?.count ?? 0);
}

/**
 * Every record the book ever held, soft-deleted ones included. Deleting the book
 * would have to break the records' foreign key, so this is the count that
 * decides whether a delete is possible at all.
 */
async function countDocumentsIncludingDeleted(
  tx: Pick<typeof db, "select">,
  ledgerId: string,
  bookId: string
): Promise<number> {
  const rows = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(sourceDocuments)
    .where(and(eq(sourceDocuments.ledgerId, ledgerId), eq(sourceDocuments.bookId, bookId)));
  return Number(rows[0]?.count ?? 0);
}

/**
 * The refusals shared by archive and delete: the default book is where 总账
 * records land, and the last live book would leave the instance with nowhere to
 * file anything. Both throw, because the caller maps them to a code.
 */
async function assertNotDefaultOrLast(
  tx: Pick<typeof db, "select">,
  ledgerId: string,
  book: BookRow
): Promise<void> {
  if (book.isDefault) throw new ValidationError("The default book cannot be archived");
  if ((await countLiveBooks(tx, ledgerId)) <= 1) {
    throw new ValidationError("The last active book cannot be archived");
  }
}

export const postgresBookAdapter: BookPort = {
  async list(ledgerId, options) {
    const rows = await db
      .select()
      .from(books)
      .where(
        options?.includeArchived === true ? eq(books.ledgerId, ledgerId) : liveBooksWhere(ledgerId)
      )
      .orderBy(asc(books.sortOrder), asc(books.createdAt), asc(books.id));
    return rows.map(toBook);
  },

  async get(ledgerId, bookId) {
    const row = await db
      .select()
      .from(books)
      .where(and(eq(books.ledgerId, ledgerId), eq(books.id, bookId), isNull(books.archivedAt)))
      .limit(1)
      .then((rows) => rows[0]);
    return row == null ? null : toBook(row);
  },

  async getIncludingArchived(ledgerId, bookId) {
    // Display only: a record may still point at a book that has since been
    // retired, and the detail page has to name it instead of showing a blank.
    const row = await db
      .select()
      .from(books)
      .where(and(eq(books.ledgerId, ledgerId), eq(books.id, bookId)))
      .limit(1)
      .then((rows) => rows[0]);
    return row == null ? null : toBook(row);
  },

  async create(ledgerId, input) {
    return db.transaction(async (tx) => {
      const next = await tx
        .select({ sortOrder: sql<number | null>`max(${books.sortOrder})` })
        .from(books)
        .where(eq(books.ledgerId, ledgerId))
        .then((rows) => Number(rows[0]?.sortOrder ?? 0) + 1);
      const created = await tx
        .insert(books)
        .values({
          ledgerId,
          name: input.name,
          timeZone: input.timeZone,
          sortOrder: next,
          isDefault: input.isDefault === true,
        })
        .onConflictDoNothing()
        .returning()
        .then((rows) => rows[0]);
      if (created == null) throw duplicateNameError();
      return toBook(created);
    });
  },

  async update(ledgerId, bookId, input) {
    const updated = await db
      .update(books)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
        updatedAt: new Date(),
      })
      .where(and(eq(books.id, bookId), eq(books.ledgerId, ledgerId), isNull(books.archivedAt)))
      .returning()
      .then((rows) => rows[0])
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) throw duplicateNameError();
        throw error;
      });
    return updated == null ? null : toBook(updated);
  },

  async reorder(ledgerId, bookIds) {
    return db.transaction(async (tx) => {
      const live = await tx.select({ id: books.id }).from(books).where(liveBooksWhere(ledgerId));
      const liveIds = new Set(live.map((row) => row.id));
      if (liveIds.size !== bookIds.length || bookIds.some((id) => !liveIds.has(id))) {
        throw new ValidationError("Reorder must list every active book exactly once");
      }
      // One statement rather than one UPDATE per row. Positions come from a
      // VALUES list whose order is the caller's order, so no row can briefly
      // hold another row's position while the rewrite is in flight.
      const positions = sql.join(
        bookIds.map((id, index) => sql`(${id}::uuid, ${index + 1}::int)`),
        sql`, `
      );
      await tx.execute(sql`
        UPDATE books AS b
           SET sort_order = ordered.position, updated_at = now()
          FROM (VALUES ${positions}) AS ordered(id, position)
         WHERE b.id = ordered.id AND b.ledger_id = ${ledgerId}
      `);
      const rows = await tx
        .select()
        .from(books)
        .where(liveBooksWhere(ledgerId))
        .orderBy(asc(books.sortOrder), asc(books.createdAt), asc(books.id));
      return rows.map(toBook);
    });
  },

  async archive(ledgerId, bookId) {
    return db.transaction(async (tx) => {
      const book = await tx
        .select()
        .from(books)
        .where(and(eq(books.id, bookId), eq(books.ledgerId, ledgerId)))
        .limit(1)
        .then((rows) => rows[0]);
      if (book == null || book.archivedAt != null) return { status: "not_found" as const };
      // A key bound to the book would keep uploading into a retired book, so it
      // has to be rebound first. Checked before the default/last rules, because
      // the reader can act on this one.
      if ((await countCredentials(tx, ledgerId, bookId)) > 0) {
        return { status: "has_credentials" as const };
      }
      await assertNotDefaultOrLast(tx, ledgerId, book);
      const archived = await tx
        .update(books)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(books.id, bookId), eq(books.ledgerId, ledgerId), isNull(books.archivedAt)))
        .returning()
        .then((rows) => rows[0]);
      if (archived == null) return { status: "not_found" as const };
      return { status: "archived" as const, book: toBook(archived) };
    });
  },

  async restore(ledgerId, bookId) {
    return db.transaction(async (tx) => {
      const restored = await tx
        .update(books)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(and(eq(books.id, bookId), eq(books.ledgerId, ledgerId), isNotNull(books.archivedAt)))
        .returning()
        .then((rows) => rows[0])
        .catch((error: unknown) => {
          // Bringing a book back can collide with a live book that took its
          // name while it was retired.
          if (isUniqueViolation(error)) throw duplicateNameError();
          throw error;
        });
      if (restored == null) throw new NotFoundError("Book");
      return toBook(restored);
    });
  },

  async delete(ledgerId, bookId) {
    return db.transaction(async (tx) => {
      const book = await tx
        .select()
        .from(books)
        .where(and(eq(books.id, bookId), eq(books.ledgerId, ledgerId)))
        .limit(1)
        .then((rows) => rows[0]);
      if (book == null) return { status: "not_found" as const };
      // Soft-deleted records count too: the foreign key still points at this
      // book, so removing the row would fail or orphan them.
      if ((await countDocumentsIncludingDeleted(tx, ledgerId, bookId)) > 0) {
        return { status: "has_records" as const };
      }
      if ((await countCredentials(tx, ledgerId, bookId)) > 0) {
        return { status: "has_credentials" as const };
      }
      // Deleting is only offered for a live book; an archived one is restored
      // first, so a retired book cannot vanish without the reader seeing it.
      if (book.archivedAt != null) return { status: "not_found" as const };
      await assertNotDefaultOrLast(tx, ledgerId, book);
      const removed = await tx
        .delete(books)
        .where(and(eq(books.id, bookId), eq(books.ledgerId, ledgerId)))
        .returning({ id: books.id })
        .then((rows) => rows[0]);
      if (removed == null) return { status: "not_found" as const };
      return { status: "deleted" as const };
    });
  },

  async setDefault(ledgerId, bookId) {
    return db.transaction(async (tx) => {
      const target = await tx
        .select({ id: books.id })
        .from(books)
        .where(and(eq(books.id, bookId), eq(books.ledgerId, ledgerId), isNull(books.archivedAt)))
        .limit(1)
        .then((rows) => rows[0]);
      if (target == null) throw new NotFoundError("Book");
      // Clear first: the partial unique index only tolerates one flagged row.
      await tx
        .update(books)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(and(eq(books.ledgerId, ledgerId), eq(books.isDefault, true)));
      await tx
        .update(books)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(and(eq(books.id, bookId), eq(books.ledgerId, ledgerId)));
      const rows = await tx
        .select()
        .from(books)
        .where(liveBooksWhere(ledgerId))
        .orderBy(asc(books.sortOrder), asc(books.createdAt), asc(books.id));
      return rows.map(toBook);
    });
  },

  async countDocuments(ledgerId, bookId) {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sourceDocuments)
      .where(
        and(
          eq(sourceDocuments.ledgerId, ledgerId),
          eq(sourceDocuments.bookId, bookId),
          isNull(sourceDocuments.deletedAt)
        )
      );
    return Number(rows[0]?.count ?? 0);
  },

  async hasCredentials(ledgerId, bookId) {
    return (await countCredentials(db, ledgerId, bookId)) > 0;
  },
};

/**
 * Drizzle wraps driver failures in a `DrizzleQueryError` whose `cause` is the
 * original Postgres error, so the SQLSTATE is one level down from what the
 * caller catches. Only the live-name index matters here: the default flag is
 * moved by `setDefault`, which clears it first.
 */
function isUniqueViolation(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && candidate != null; depth += 1) {
    if (
      candidate instanceof Error &&
      "code" in candidate &&
      (candidate as { code?: unknown }).code === "23505"
    ) {
      return true;
    }
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return false;
}
