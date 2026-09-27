import "server-only";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { signInChallenges } from "@/persistence";
import { getOTPExpiration, hashOTP } from "@/modules/auth/domain/otp";
import { carriedFailures, recordedFailure } from "./challenge-failures";

export interface SignInChallengeRecord {
  email: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  lockedUntil: Date | null;
}

async function replaceSignInChallenge(input: {
  email: string;
  codeHash: string;
  expiresAt: Date;
}): Promise<void> {
  const now = new Date();
  await db
    .insert(signInChallenges)
    .values({
      email: input.email,
      codeHash: input.codeHash,
      expiresAt: input.expiresAt,
    })
    .onConflictDoUpdate({
      target: signInChallenges.email,
      set: {
        codeHash: input.codeHash,
        expiresAt: input.expiresAt,
        ...carriedFailures(signInChallenges, now),
        createdAt: now,
      },
    });
}

/** The live token for an address, matched after lowercasing. */
export async function findSignInChallenge(email: string): Promise<SignInChallengeRecord | null> {
  const row = await db
    .select()
    .from(signInChallenges)
    .where(eq(signInChallenges.email, email.toLowerCase()))
    .limit(1)
    .then((rows) => rows[0]);
  return row == null
    ? null
    : {
        email: row.email,
        codeHash: row.codeHash,
        expiresAt: row.expiresAt,
        attempts: row.attempts,
        lockedUntil: row.lockedUntil,
      };
}

export async function recordOtpFailure(input: {
  email: string;
  codeHash: string;
  maxAttempts: number;
  lockedUntil: Date;
}): Promise<{ attempts: number; lockedUntil: Date | null } | null> {
  const rows = await db
    .update(signInChallenges)
    .set(recordedFailure(signInChallenges, { ...input, now: new Date() }))
    .where(
      and(
        eq(signInChallenges.email, input.email),
        eq(signInChallenges.codeHash, input.codeHash),
        sql`${signInChallenges.attempts} < ${input.maxAttempts}`
      )
    )
    .returning({ attempts: signInChallenges.attempts, lockedUntil: signInChallenges.lockedUntil });
  return rows[0] ?? null;
}

/**
 * Spend the token. Returns false if it was already spent, has expired, is
 * locked out, or has run out of attempts — the same conditions the caller
 * checked a moment ago, re-checked here so that two simultaneous verifies
 * cannot both win.
 */
export async function consumeSignInChallenge(input: {
  email: string;
  codeHash: string;
  now: Date;
  maxAttempts: number;
}): Promise<boolean> {
  const rows = await db
    .delete(signInChallenges)
    .where(
      and(
        eq(signInChallenges.email, input.email),
        eq(signInChallenges.codeHash, input.codeHash),
        sql`${signInChallenges.expiresAt} > ${input.now}`,
        sql`${signInChallenges.attempts} < ${input.maxAttempts}`,
        or(
          isNull(signInChallenges.lockedUntil),
          sql`${signInChallenges.lockedUntil} <= ${input.now}`
        )
      )
    )
    .returning({ id: signInChallenges.id });
  return rows.length === 1;
}

async function deleteSignInChallenge(input: { email: string; codeHash: string }): Promise<boolean> {
  const rows = await db
    .delete(signInChallenges)
    .where(
      and(eq(signInChallenges.email, input.email), eq(signInChallenges.codeHash, input.codeHash))
    )
    .returning({ id: signInChallenges.id });
  return rows.length === 1;
}

/** Issues a token for `otp`, replacing any earlier one for the same address. */
export async function createSignInChallenge(
  email: string,
  otp: string
): Promise<{ expiresAt: Date; codeHash: string }> {
  const normalizedEmail = email.toLowerCase();
  const expiresAt = getOTPExpiration();
  const codeHash = hashOTP(otp);
  await replaceSignInChallenge({
    email: normalizedEmail,
    codeHash,
    expiresAt,
  });
  logger.info({ subject: logIdentifier("email", normalizedEmail) }, "OTP token created");
  return { expiresAt, codeHash };
}

/** Removes the token only if it is still the one that was issued. */
export async function discardSignInChallenge(email: string, codeHash: string): Promise<boolean> {
  const discarded = await deleteSignInChallenge({ email: email.toLowerCase(), codeHash });
  if (discarded) {
    logger.info({ subject: logIdentifier("email", email) }, "OTP token discarded");
  }
  return discarded;
}
