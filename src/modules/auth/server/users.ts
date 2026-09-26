import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { loginEmails, users } from "@/persistence";

/**
 * The one account. `email` is the address the caller signed in with or, for a
 * lookup by id, the account's first login address — never the only one it has.
 */
export interface UserAccount {
  id: string;
  email: string;
}

export interface LoginEmail {
  email: string;
  emailVerifiedAt: string | null;
}

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

/** `email` is one of the account's login addresses, matched case-insensitively. */
export async function findUserByEmail(email: string): Promise<UserAccount | null> {
  const row = await db
    .select({
      id: users.id,
      loginEmail: loginEmails.email,
    })
    .from(loginEmails)
    .innerJoin(users, eq(users.id, loginEmails.userId))
    // Matching the `uniq_login_emails_email` index on `lower(email)` keeps the
    // lookup case-insensitive without making every caller normalize first.
    .where(sql`lower(${loginEmails.email}) = lower(${email})`)
    .limit(1)
    .then((rows) => rows[0]);
  return row == null ? null : { id: row.id, email: row.loginEmail };
}

export async function findUserById(id: string): Promise<UserAccount | null> {
  const row = await db.query.users.findFirst({
    where: eq(users.id, id),
    columns: { id: true },
  });
  if (row == null) return null;
  return { id: row.id, email: await firstLoginEmail(row.id) };
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
