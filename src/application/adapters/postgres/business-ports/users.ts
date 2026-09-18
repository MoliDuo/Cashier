import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { UserAccountPort, UserPreferencesPort } from "@/application/contracts";
import { db } from "@/lib/db";
import { loginEmails, users } from "@/persistence";
import { normalizeUserPreferences } from "@/modules/auth/services/user-preferences";

const accountColumns = {
  id: true,
  name: true,
  image: true,
  passwordHash: true,
  passwordUpdatedAt: true,
  authVersion: true,
  preferences: true,
} as const;

type AccountRow = {
  id: string;
  name: string | null;
  image: string | null;
  passwordHash: string | null;
  passwordUpdatedAt: Date | null;
  authVersion: number;
  preferences: unknown;
};

/**
 * The account's first login address, oldest first. `email` on the contract is
 * that address, so a caller that only needs "an address to show" does not have
 * to know which one the reader signed in with.
 */
async function firstLoginEmail(userId: string): Promise<string> {
  const row = await db
    .select({ email: loginEmails.email })
    .from(loginEmails)
    .where(eq(loginEmails.userId, userId))
    .orderBy(asc(loginEmails.createdAt), asc(loginEmails.id))
    .limit(1)
    .then((rows) => rows[0]);
  return row?.email ?? "";
}

function toAccount(row: AccountRow, email: string) {
  return {
    id: row.id,
    email,
    name: row.name,
    image: row.image,
    passwordHash: row.passwordHash,
    passwordUpdatedAt: row.passwordUpdatedAt,
    authVersion: row.authVersion,
    interfaceLanguage: normalizeUserPreferences(row.preferences).interfaceLanguage,
  };
}

export const postgresUserAccountAdapter: UserAccountPort = {
  async findByEmail(email) {
    const row = await db
      .select({
        id: users.id,
        name: users.name,
        image: users.image,
        passwordHash: users.passwordHash,
        passwordUpdatedAt: users.passwordUpdatedAt,
        authVersion: users.authVersion,
        preferences: users.preferences,
        loginEmail: loginEmails.email,
      })
      .from(loginEmails)
      .innerJoin(users, and(eq(users.id, loginEmails.userId), isNull(users.deletedAt)))
      // Matching the `uniq_login_emails_email` index on `lower(email)` keeps the
      // lookup case-insensitive without making every caller normalize first.
      .where(sql`lower(${loginEmails.email}) = lower(${email})`)
      .limit(1)
      .then((rows) => rows[0]);
    return row == null ? null : toAccount(row, row.loginEmail);
  },

  async findById(id) {
    const row = await db.query.users.findFirst({
      where: and(eq(users.id, id), isNull(users.deletedAt)),
      columns: accountColumns,
    });
    if (row == null) return null;
    return toAccount(row, await firstLoginEmail(row.id));
  },

  async listLoginEmails(userId) {
    const rows = await db
      .select({ email: loginEmails.email, emailVerified: loginEmails.emailVerified })
      .from(loginEmails)
      .where(eq(loginEmails.userId, userId))
      .orderBy(asc(loginEmails.createdAt), asc(loginEmails.id));
    return rows.map((row) => ({
      email: row.email,
      emailVerifiedAt: row.emailVerified?.toISOString() ?? null,
    }));
  },
};

export const postgresUserPreferencesAdapter: UserPreferencesPort = {
  async get(userId) {
    const row = await db.query.users.findFirst({
      where: and(eq(users.id, userId), isNull(users.deletedAt)),
      columns: { preferences: true },
    });
    return row == null ? null : normalizeUserPreferences(row.preferences);
  },

  async update(input) {
    const updated = await db
      .update(users)
      .set({ preferences: input.preferences, updatedAt: new Date() })
      .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
      .returning({ preferences: users.preferences })
      .then((rows) => rows[0]);
    return updated == null ? null : normalizeUserPreferences(updated.preferences);
  },
};
