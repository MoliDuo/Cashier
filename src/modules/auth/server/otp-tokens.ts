import "server-only";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { otpTokens } from "@/persistence";
import { getOTPExpiration, hashOTP } from "@/modules/auth/domain/otp";
import { OTP_LOCKOUT_MINUTES } from "@/config/tuning";

export interface OtpToken {
  email: string;
  tokenHash: string;
  expiresAt: Date;
  attempts: number;
  lockedUntil: Date | null;
}

async function replaceOtpToken(input: {
  email: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<void> {
  const now = new Date();
  const recentFailureCutoff = new Date(now.getTime() - OTP_LOCKOUT_MINUTES * 60 * 1000);
  await db
    .insert(otpTokens)
    .values({
      email: input.email,
      tokenHash: input.tokenHash,
      expires: input.expiresAt,
    })
    .onConflictDoUpdate({
      target: otpTokens.email,
      set: {
        tokenHash: input.tokenHash,
        expires: input.expiresAt,
        // A fresh code does not refill the guessing budget: failed attempts
        // carry over until a whole lockout window passes without one, and a
        // lockout outlives any number of resends.
        attempts: sql`case
          when ${otpTokens.lockedUntil} > ${now}
            or ${otpTokens.lastAttemptAt} > ${recentFailureCutoff}
          then ${otpTokens.attempts}
          else 0
        end`,
        lockedUntil: sql`case
          when ${otpTokens.lockedUntil} > ${now} then ${otpTokens.lockedUntil}
        end`,
        createdAt: now,
      },
    });
}

/** The live token for an address, matched after lowercasing. */
export async function findOtpToken(email: string): Promise<OtpToken | null> {
  const row = await db
    .select()
    .from(otpTokens)
    .where(eq(otpTokens.email, email.toLowerCase()))
    .limit(1)
    .then((rows) => rows[0]);
  return row == null
    ? null
    : {
        email: row.email,
        tokenHash: row.tokenHash,
        expiresAt: row.expires,
        attempts: row.attempts,
        lockedUntil: row.lockedUntil,
      };
}

export async function recordOtpFailure(input: {
  email: string;
  tokenHash: string;
  maxAttempts: number;
  lockedUntil: Date;
}): Promise<{ attempts: number; lockedUntil: Date | null } | null> {
  const rows = await db
    .update(otpTokens)
    .set({
      attempts: sql`${otpTokens.attempts} + 1`,
      lastAttemptAt: new Date(),
      lockedUntil: sql`case
        when ${otpTokens.attempts} + 1 >= ${input.maxAttempts} then ${input.lockedUntil}
        else ${otpTokens.lockedUntil}
      end`,
    })
    .where(
      and(
        eq(otpTokens.email, input.email),
        eq(otpTokens.tokenHash, input.tokenHash),
        sql`${otpTokens.attempts} < ${input.maxAttempts}`
      )
    )
    .returning({ attempts: otpTokens.attempts, lockedUntil: otpTokens.lockedUntil });
  return rows[0] ?? null;
}

/**
 * Spend the token. Returns false if it was already spent, has expired, is
 * locked out, or has run out of attempts — the same conditions the caller
 * checked a moment ago, re-checked here so that two simultaneous verifies
 * cannot both win.
 */
export async function consumeOtpToken(input: {
  email: string;
  tokenHash: string;
  now: Date;
  maxAttempts: number;
}): Promise<boolean> {
  const rows = await db
    .delete(otpTokens)
    .where(
      and(
        eq(otpTokens.email, input.email),
        eq(otpTokens.tokenHash, input.tokenHash),
        sql`${otpTokens.expires} > ${input.now}`,
        sql`${otpTokens.attempts} < ${input.maxAttempts}`,
        or(isNull(otpTokens.lockedUntil), sql`${otpTokens.lockedUntil} <= ${input.now}`)
      )
    )
    .returning({ id: otpTokens.id });
  return rows.length === 1;
}

async function deleteOtpToken(input: { email: string; tokenHash: string }): Promise<boolean> {
  const rows = await db
    .delete(otpTokens)
    .where(and(eq(otpTokens.email, input.email), eq(otpTokens.tokenHash, input.tokenHash)))
    .returning({ id: otpTokens.id });
  return rows.length === 1;
}

/** Issues a token for `otp`, replacing any earlier one for the same address. */
export async function createOtpToken(
  email: string,
  otp: string
): Promise<{ expiresAt: Date; tokenHash: string }> {
  const normalizedEmail = email.toLowerCase();
  const expiresAt = getOTPExpiration();
  const tokenHash = hashOTP(otp);
  await replaceOtpToken({
    email: normalizedEmail,
    tokenHash,
    expiresAt,
  });
  logger.info({ subject: logIdentifier("email", normalizedEmail) }, "OTP token created");
  return { expiresAt, tokenHash };
}

/** Removes the token only if it is still the one that was issued. */
export async function discardOtpToken(email: string, tokenHash: string): Promise<boolean> {
  const discarded = await deleteOtpToken({ email: email.toLowerCase(), tokenHash });
  if (discarded) {
    logger.info({ subject: logIdentifier("email", email) }, "OTP token discarded");
  }
  return discarded;
}
