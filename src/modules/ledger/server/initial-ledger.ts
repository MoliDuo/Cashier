import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { AppError, ConflictError, ValidationError } from "@/lib/errors";
import { books, entryCategories, ledgers } from "@/persistence";
import { DEFAULT_CATEGORIES } from "@/config/default-categories";

export interface InitialLedgerInput {
  bookNames: readonly string[];
}

/**
 * Creates the one ledger from the command line: the ledger, its books and the
 * default categories, in a single transaction. Who may use it is the identity
 * provider's decision, so nothing here names a person.
 */
export async function createInitialLedger(input: InitialLedgerInput): Promise<void> {
  const bookNames = input.bookNames.map((name) => name.trim()).filter((name) => name !== "");
  if (bookNames.length === 0) throw new ValidationError("At least one book is required");
  if (new Set(bookNames).size !== bookNames.length) {
    throw new ValidationError("Book names must be unique");
  }

  await db.transaction(async (tx) => {
    // Two concurrent runs would otherwise both see an empty database.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('cashier-initial-ledger'))`);
    // The app reads exactly one ledger; a second would lock it out.
    const existingLedger = await tx.execute(sql`SELECT 1 FROM ${ledgers} LIMIT 1`);
    if (existingLedger.rows.length > 0) throw new ConflictError("A ledger already exists");

    // The books and categories take the ledger from the row inserted here.
    const [ledger] = await tx
      .insert(ledgers)
      .values({})
      .returning({ createdAt: ledgers.createdAt });
    if (ledger == null) throw new AppError("Failed to create the ledger", "LEDGER_FAILED", 500);

    await tx.insert(books).values(
      bookNames.map((name, index) => ({
        name,
        sortOrder: index + 1,
      }))
    );

    // 0-based, matching what `saveEntryCategories` writes.
    await tx.insert(entryCategories).values(
      DEFAULT_CATEGORIES.map((category, index) => ({
        name: category.name,
        description: category.description,
        icon: category.icon,
        sortOrder: index,
      }))
    );
  });
}
