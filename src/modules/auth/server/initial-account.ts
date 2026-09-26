import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { AppError, ConflictError, ValidationError } from "@/lib/errors";
import { books, entryCategories, ledgers, loginEmails, users } from "@/persistence";
import { getCategoryPreset } from "@/config/category-presets";

export interface InitialAccountInput {
  bookNames: readonly string[];
  email: string;
}

export interface InitialAccountResult {
  userId: string;
  ledgerId: string;
}

/** True once the instance has an account, which is what a sign-in needs. */
export async function hasAccount(): Promise<boolean> {
  const result = await db.execute<{ exists: boolean }>(
    sql`SELECT EXISTS (SELECT 1 FROM ${users}) AS "exists"`
  );
  return result.rows[0]?.exists === true;
}

/**
 * Creates the one account from the command line: the user, its verified login
 * address, the ledger, the books and the default categories, in a single
 * transaction. The account has no credential yet; `account:enroll` issues the
 * link that adds its first passkey.
 */
export async function createInitialAccount(
  input: InitialAccountInput
): Promise<InitialAccountResult> {
  const bookNames = input.bookNames.map((name) => name.trim()).filter((name) => name !== "");
  if (bookNames.length === 0) throw new ValidationError("At least one book is required");
  if (new Set(bookNames).size !== bookNames.length) {
    throw new ValidationError("Book names must be unique");
  }
  const email = input.email.trim().toLowerCase();
  const categories = getCategoryPreset("default");
  const now = new Date();

  return db.transaction(async (tx) => {
    // Two concurrent runs would otherwise both see an empty database.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('cashier-initial-account'))`);
    const taken = await tx.execute(
      sql`SELECT 1 FROM ${loginEmails} WHERE lower(${loginEmails.email}) = ${email} LIMIT 1`
    );
    if (taken.rows.length > 0) throw new ConflictError("That email already signs in");
    const existing = await tx.select({ id: users.id }).from(users).limit(1);
    if (existing.length > 0) throw new ConflictError("An account already exists");
    // The app reads exactly one ledger; a second would lock the account out.
    const existingLedger = await tx.select({ id: ledgers.id }).from(ledgers).limit(1);
    if (existingLedger.length > 0) throw new ConflictError("A ledger already exists");

    const [user] = await tx.insert(users).values({}).returning();
    if (user == null) throw new AppError("Failed to create the account", "ACCOUNT_FAILED", 500);

    await tx.insert(loginEmails).values({ userId: user.id, email, emailVerified: now });

    const [ledger] = await tx.insert(ledgers).values({}).returning();
    if (ledger == null) throw new AppError("Failed to create the ledger", "ACCOUNT_FAILED", 500);

    await tx.insert(books).values(
      bookNames.map((name, index) => ({
        ledgerId: ledger.id,
        name,
        timeZone: null,
        sortOrder: index + 1,
      }))
    );

    // 0-based, matching what `saveEntryCategories` writes and the order the
    // preset dialog offers, so a later preset switch is a no-op not a merge.
    await tx.insert(entryCategories).values(
      categories.map((category, index) => ({
        ledgerId: ledger.id,
        name: category.name,
        description: category.description,
        icon: category.icon,
        sortOrder: index,
      }))
    );

    return { userId: user.id, ledgerId: ledger.id };
  });
}
