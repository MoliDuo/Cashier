import "server-only";
import crypto from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { PostgresTransaction } from "@/lib/db/transaction-locks";
import { keyedDigest } from "@/lib/security/keys";
import { loginEmails, sessions, users } from "@/persistence";
import { SESSION_MAX_AGE_DAYS } from "@/config/tuning";

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_DAYS * DAY_MS;
/** A session is extended at most once a day, so reads rarely write. */
const SESSION_RENEW_AFTER_MS = DAY_MS;

export interface SessionUser {
  sessionId: string;
  userId: string;
  /** The account's first login address, for display. */
  email: string;
  hasPassword: boolean;
  passwordUpdatedAt: Date | null;
  authenticatedAt: Date;
  expiresAt: Date;
}

function hashSessionToken(token: string): string {
  return keyedDigest("session", token);
}

/** Opens a session for a user who has just proven who they are. */
export async function createSession(
  userId: string,
  now = new Date()
): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_MS);
  await db.insert(sessions).values({
    tokenHash: hashSessionToken(token),
    userId,
    createdAt: now,
    expiresAt,
    lastSeenAt: now,
    authenticatedAt: now,
  });
  return { token, expiresAt };
}

/**
 * The live session a cookie names, with its account, in one query. A session
 * last seen over a day ago is pushed out to a full lifetime from now.
 */
export async function readSession(token: string, now = new Date()): Promise<SessionUser | null> {
  const row = await db
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      lastSeenAt: sessions.lastSeenAt,
      authenticatedAt: sessions.authenticatedAt,
      expiresAt: sessions.expiresAt,
      passwordHash: users.passwordHash,
      passwordUpdatedAt: users.passwordUpdatedAt,
      email: sql<string | null>`(
        SELECT ${loginEmails.email} FROM ${loginEmails}
        WHERE ${loginEmails.userId} = ${sessions.userId}
        ORDER BY ${loginEmails.createdAt}, ${loginEmails.id}
        LIMIT 1
      )`,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashSessionToken(token)), gt(sessions.expiresAt, now)))
    .limit(1)
    .then((rows) => rows[0]);
  if (row == null) return null;

  let expiresAt = row.expiresAt;
  if (now.getTime() - row.lastSeenAt.getTime() >= SESSION_RENEW_AFTER_MS) {
    expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_MS);
    await db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt })
      .where(eq(sessions.id, row.sessionId));
  }

  return {
    sessionId: row.sessionId,
    userId: row.userId,
    email: row.email ?? "",
    hasPassword: row.passwordHash != null,
    passwordUpdatedAt: row.passwordUpdatedAt,
    authenticatedAt: row.authenticatedAt,
    expiresAt,
  };
}

export async function deleteSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
}

/** Ends every session of the account, in the caller's transaction when given one. */
export async function deleteUserSessions(
  userId: string,
  executor: PostgresTransaction | typeof db = db
): Promise<void> {
  await executor.delete(sessions).where(eq(sessions.userId, userId));
}
