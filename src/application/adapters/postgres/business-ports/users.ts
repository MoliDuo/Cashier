import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { UserAccountPort } from "@/application/contracts";
import { db } from "@/lib/db";
import { loginEmails, users } from "@/persistence";

const accountColumns = {
  id: true,
  passwordHash: true,
  passwordUpdatedAt: true,
  authVersion: true,
} as const;

type AccountRow = {
  id: string;
  passwordHash: string | null;
  passwordUpdatedAt: Date | null;
  authVersion: number;
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
    passwordHash: row.passwordHash,
    passwordUpdatedAt: row.passwordUpdatedAt,
    authVersion: row.authVersion,
  };
}

export const postgresUserAccountAdapter: UserAccountPort = {
  async findByEmail(email) {
    const row = await db
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
        passwordUpdatedAt: users.passwordUpdatedAt,
        authVersion: users.authVersion,
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
