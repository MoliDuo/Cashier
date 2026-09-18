import { isNull, sql } from "drizzle-orm";
import crypto from "node:crypto";
import type { SetupPort } from "@/application/contracts";
import { runtimeEnv } from "@/lib/env/runtime";
import { db } from "@/lib/db";
import { AppError, ConflictError } from "@/lib/errors";
import { books, entryCategories, ledgers, loginEmails, setupState, users } from "@/persistence";
import { hashPassword } from "@/modules/auth/services/password";
import {
  generateSetupCode,
  SETUP_CODE_MAX_ATTEMPTS,
  SETUP_CODE_TTL_MS,
} from "@/modules/setup/setup-code";
import { getCategoryPreset } from "@/config/category-presets";

/**
 * Hashes the setup code the way OTPs are hashed: the plaintext only ever exists
 * in the server's logs. A salted HMAC means the stored value is not a usable
 * secret even if the database is read or restored.
 */
function hashSetupCode(code: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .createHmac("sha256", runtimeEnv.authOtpPepper)
    .update(`${salt}:${code}`)
    .digest("hex");
  return `v1:${hash}:${salt}`;
}

function setupCodeMatches(code: string, stored: string): boolean {
  const [version, hash, salt] = stored.split(":");
  if (version !== "v1" || hash == null || salt == null) return false;
  const candidate = crypto
    .createHmac("sha256", runtimeEnv.authOtpPepper)
    .update(`${salt}:${code}`)
    .digest("hex");
  const expected = Buffer.from(hash, "utf8");
  const actual = Buffer.from(candidate, "utf8");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function isExpired(issuedAt: Date): boolean {
  return Date.now() - issuedAt.getTime() >= SETUP_CODE_TTL_MS;
}

/**
 * First-run setup: the one write path that runs without a session.
 *
 * Everything the wizard collects — the account, its login address and password,
 * the ledger, the books and the default categories — is written in a single
 * transaction. A half-created instance would leave `/setup` past its guard with
 * no account able to sign in, so partial success is not an option.
 */
export const postgresSetupAdapter: SetupPort = {
  async getOrCreateCode() {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('cashier-first-run-setup'))`);
      const existing = await tx.query.setupState.findFirst({
        columns: { codeHash: true, createdAt: true },
      });
      // An existing hash cannot be turned back into the code the operator needs
      // to read, so the only way to hand out a readable code is to have just
      // written it. A stored code past its lifetime is replaced for that reason:
      // otherwise a code whose log line was missed would refuse every attempt
      // and there would be no way left to finish setup.
      if (existing != null && !isExpired(existing.createdAt)) {
        return { code: "", created: false, issuedAt: existing.createdAt };
      }
      const code = generateSetupCode();
      const issuedAt = new Date();
      if (existing == null) {
        await tx.insert(setupState).values({ codeHash: hashSetupCode(code), createdAt: issuedAt });
      } else {
        // The lockout counter belongs to the retired code, so it starts over.
        await tx
          .update(setupState)
          .set({ codeHash: hashSetupCode(code), createdAt: issuedAt, failedAttempts: 0 });
      }
      return { code, created: true, issuedAt };
    });
  },

  async verifyCode(code) {
    return db.transaction(async (tx) => {
      // Two guesses racing must not both read the same counter, or a burst of
      // parallel attempts could spend more than the allowance.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('cashier-first-run-setup'))`);
      const row = await tx.query.setupState.findFirst({
        columns: { codeHash: true, createdAt: true, failedAttempts: true },
      });
      if (row == null) return "expired";
      if (isExpired(row.createdAt)) return "expired";
      if (setupCodeMatches(code, row.codeHash)) return "accepted";

      const attempts = row.failedAttempts + 1;
      if (attempts >= SETUP_CODE_MAX_ATTEMPTS) {
        // Retire it: the next visit issues and prints a fresh code, so the
        // operator is never left with a code that can no longer be accepted.
        await tx.delete(setupState);
        return "locked_out";
      }
      await tx.update(setupState).set({ failedAttempts: attempts });
      return "mismatch";
    });
  },

  async isPending() {
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
  },

  async createInitialAccount(input) {
    const categories = getCategoryPreset("default", input.locale);
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
        email: input.email,
        emailVerified: now,
      });

      const [ledger] = await tx.insert(ledgers).values({ userId: user.id }).returning();
      if (ledger == null) throw new AppError("Failed to create the ledger", "SETUP_FAILED", 500);

      await tx.insert(books).values(
        input.bookNames.map((name, index) => ({
          ledgerId: ledger.id,
          name,
          timeZone: null,
          sortOrder: index + 1,
          isDefault: name === input.defaultBookName,
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
  },
};
