import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { BookContract, BookPort } from "@/application/contracts";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { books, sourceDocuments } from "@/persistence";

type BookRow = typeof books.$inferSelect;

function toBook(row: BookRow): BookContract {
  return {
    id: row.id,
    ledgerId: row.ledgerId,
    name: row.name,
    timeZone: row.timeZone,
    sortOrder: row.sortOrder,
    isDefault: row.isDefault,
  };
}

function liveBooksWhere(ledgerId: string) {
  return and(eq(books.ledgerId, ledgerId), isNull(books.archivedAt))!;
}

function duplicateNameError() {
  return new ConflictError("A book with that name already exists");
}

/**
 * The archive rules the product states, in one place: a book that still holds
 * records can only be archived, and the last active book and the 总账 default
 * book cannot be archived at all. Archiving is therefore only reachable for an
 * empty book that is not the default.
 */
async function assertArchivable(
  tx: Pick<typeof db, "select">,
  ledgerId: string,
  bookId: string
): Promise<BookRow> {
  const book = await tx
    .select()
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.ledgerId, ledgerId)))
    .limit(1)
    .then((rows) => rows[0]);
  if (book == null || book.archivedAt != null) throw new NotFoundError("Book");
  if (book.isDefault) throw new ValidationError("The default book cannot be archived");
  const live = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(books)
    .where(liveBooksWhere(ledgerId))
    .then((rows) => Number(rows[0]?.count ?? 0));
  if (live <= 1) throw new ValidationError("The last active book cannot be archived");
  return book;
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
      await assertArchivable(tx, ledgerId, bookId);
      const records = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(sourceDocuments)
        .where(
          and(
            eq(sourceDocuments.ledgerId, ledgerId),
            eq(sourceDocuments.bookId, bookId),
            isNull(sourceDocuments.deletedAt)
          )
        )
        .then((rows) => Number(rows[0]?.count ?? 0));
      if (records > 0) return "has_records" as const;
      await tx
        .update(books)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(books.id, bookId), eq(books.ledgerId, ledgerId), isNull(books.archivedAt)));
      return "archived" as const;
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
};

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "23505";
}
