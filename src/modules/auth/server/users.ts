import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { loginEmails, users } from "@/persistence";

/**
 * The one account. `email` is the address the caller signed in with or, for a
 * lookup by id, the account's first login address — never the only one it has.
 */
export interface UserAccount {
  id: string;
  email: string;
  passwordHash: string | null;
  passwordUpdatedAt: Date | null;
  authVersion: number;
}

export interface LoginEmail {
  email: string;
  emailVerifiedAt: string | null;
}

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

function toAccount(row: AccountRow, email: string): UserAccount {
  return {
    id: row.id,
    email,
    passwordHash: row.passwordHash,
    passwordUpdatedAt: row.passwordUpdatedAt,
    authVersion: row.authVersion,
  };
}

/** `email` is one of the account's login addresses, matched case-insensitively. */
export async function findUserByEmail(email: string): Promise<UserAccount | null> {
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
}

export async function findUserById(id: string): Promise<UserAccount | null> {
  const row = await db.query.users.findFirst({
    where: and(eq(users.id, id), isNull(users.deletedAt)),
    columns: accountColumns,
  });
  if (row == null) return null;
  return toAccount(row, await firstLoginEmail(row.id));
}

/** The account's login addresses, oldest first. */
export async function listLoginEmails(userId: string): Promise<LoginEmail[]> {
  const rows = await db
    .select({ email: loginEmails.email, emailVerified: loginEmails.emailVerified })
    .from(loginEmails)
    .where(eq(loginEmails.userId, userId))
    .orderBy(asc(loginEmails.createdAt), asc(loginEmails.id));
  return rows.map((row) => ({
    email: row.email,
    emailVerifiedAt: row.emailVerified?.toISOString() ?? null,
  }));
}
