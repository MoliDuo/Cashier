import "server-only";
import { isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { AppError, ConflictError, ValidationError } from "@/lib/errors";
import { books, entryCategories, ledgers, loginEmails, setupState, users } from "@/persistence";
import { hashPassword } from "@/modules/auth/domain/password";
import { validatePassword } from "@/modules/auth/domain/password-policy";
import { getCategoryPreset } from "@/config/category-presets";

export interface SetupInput {
  bookNames: readonly string[];
  email: string;
  password: string;
}

export interface SetupResult {
  userId: string;
  ledgerId: string;
}

/** True while the instance has no account and no ledger yet. */
export async function isSetupPending(): Promise<boolean> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(isNull(users.deletedAt))
    .limit(1);
  if (existing.length > 0) return false;
  const ledgerRows = await db
    .select({ id: ledgers.id })
    .from(ledgers)
    .where(isNull(ledgers.deletedAt))
    .limit(1);
  return ledgerRows.length === 0;
}

/**
 * First-run setup: the one write path that runs without a session.
 *
 * Everything the wizard collects — the account, its login address and password,
 * the ledger, the books and the default categories — is written in a single
 * transaction. A half-created instance would leave `/setup` past its guard with
 * no account able to sign in, so partial success is not an option.
 */
export async function createInitialAccount(input: SetupInput): Promise<SetupResult> {
  // Normalize and check what the wizard collected before the one transaction
  // that writes it.
  const bookNames = input.bookNames.map((name) => name.trim()).filter((name) => name !== "");
  if (bookNames.length === 0) throw new ValidationError("At least one book is required");
  if (new Set(bookNames).size !== bookNames.length) {
    throw new ValidationError("Book names must be unique");
  }
  validatePassword(input.password);
  const email = input.email.trim().toLowerCase();

  const categories = getCategoryPreset("default");
  const passwordHash = await hashPassword(input.password);
  const now = new Date();

  return db.transaction(async (tx) => {
    // Two concurrent first requests would otherwise both see an empty
    // database and both create an account; this is what serializes them.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('cashier-first-run-setup'))`);
    const existing = await tx
      .select({ id: users.id })
      .from(users)
      .where(isNull(users.deletedAt))
      .limit(1);
    if (existing.length > 0) throw new ConflictError("Setup has already been completed");

    const [user] = await tx
      .insert(users)
      .values({ passwordHash, passwordUpdatedAt: now })
      .returning();
    if (user == null) throw new AppError("Failed to create the account", "SETUP_FAILED", 500);

    await tx.insert(loginEmails).values({
      userId: user.id,
      email,
      emailVerified: now,
    });

    const [ledger] = await tx.insert(ledgers).values({ userId: user.id }).returning();
    if (ledger == null) throw new AppError("Failed to create the ledger", "SETUP_FAILED", 500);

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

    // The code has served its purpose the moment the account exists.
    await tx.delete(setupState);

    return { userId: user.id, ledgerId: ledger.id };
  });
}
