import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailChangeChallenges, loginEmails, users } from "@/persistence";
import { verificationChallenges } from "@/modules/auth/domain/verification-challenge";
import { getLockoutExpiration, getMaxAttempts } from "@/modules/auth/domain/otp";
import { carriedFailures, recordedFailure } from "./challenge-failures";
import { deleteUserSessions } from "./sessions";

/**
 * A challenge to add an address. `duplicate` covers both an address already on
 * this account and one on another account: either way the caller must not be
 * told which, and neither case can be verified into a second row.
 */
export async function createEmailChangeChallenge(input: {
  userId: string;
  newEmail: string;
  tokenHash: string;
  expiresAt: Date;
  now: Date;
  minimumIntervalMs: number;
}): Promise<"created" | "unauthorized" | "duplicate" | "rate_limited" | "locked"> {
  return db.transaction(async (tx) => {
    const [account] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.userId))
      .for("update");
    if (account == null) return "unauthorized" as const;

    const duplicate = await tx.query.loginEmails.findFirst({
      where: eq(loginEmails.email, input.newEmail),
      columns: { id: true },
    });
    const existing = await tx.query.emailChangeChallenges.findFirst({
      where: eq(emailChangeChallenges.userId, input.userId),
      columns: { createdAt: true, lockedUntil: true },
    });
    if (duplicate != null) return "duplicate" as const;
    if (existing?.lockedUntil != null && existing.lockedUntil > input.now) {
      return "locked" as const;
    }
    if (
      existing != null &&
      input.now.getTime() - existing.createdAt.getTime() < input.minimumIntervalMs
    ) {
      return "rate_limited" as const;
    }
    await tx
      .insert(emailChangeChallenges)
      .values({
        userId: input.userId,
        newEmail: input.newEmail,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        createdAt: input.now,
      })
      .onConflictDoUpdate({
        target: emailChangeChallenges.userId,
        set: {
          newEmail: input.newEmail,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          ...carriedFailures(emailChangeChallenges, input.now),
          createdAt: input.now,
        },
      });
    return "created" as const;
  });
}

export async function discardEmailChangeChallenge(input: {
  userId: string;
  newEmail: string;
  tokenHash: string;
}): Promise<void> {
  await db
    .delete(emailChangeChallenges)
    .where(
      and(
        eq(emailChangeChallenges.userId, input.userId),
        eq(emailChangeChallenges.newEmail, input.newEmail),
        eq(emailChangeChallenges.tokenHash, input.tokenHash)
      )
    );
}

export async function verifyEmailChangeChallenge(input: {
  userId: string;
  newEmail: string;
  otp: string;
  now: Date;
}): Promise<
  | { status: "verified"; email: string }
  | { status: "not_found" | "locked" | "expired" | "duplicate" }
  | { status: "incorrect"; attemptsRemaining: number; locked: boolean }
> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select id from users where id = ${input.userId} for update`);
      const [challenge] = await tx
        .select()
        .from(emailChangeChallenges)
        .where(
          and(
            eq(emailChangeChallenges.userId, input.userId),
            eq(emailChangeChallenges.newEmail, input.newEmail)
          )
        )
        .for("update");
      if (challenge == null) return { status: "not_found" as const };
      const check = verificationChallenges.check(challenge, input.otp, input.now);
      if (!check.ok && check.reason === "locked") return { status: "locked" as const };
      if (!check.ok && check.reason === "expired") return { status: "expired" as const };
      if (!check.ok) {
        const maxAttempts = getMaxAttempts();
        const [failure] = await tx
          .update(emailChangeChallenges)
          .set(
            recordedFailure(emailChangeChallenges, {
              maxAttempts,
              lockedUntil: getLockoutExpiration(),
              now: input.now,
            })
          )
          .where(eq(emailChangeChallenges.id, challenge.id))
          .returning({ attempts: emailChangeChallenges.attempts });
        const attempts = failure?.attempts ?? maxAttempts;
        return {
          status: "incorrect" as const,
          locked: attempts >= maxAttempts,
          attemptsRemaining: Math.max(0, maxAttempts - attempts),
        };
      }
      const duplicate = await tx.query.loginEmails.findFirst({
        where: eq(loginEmails.email, input.newEmail),
        columns: { id: true },
      });
      if (duplicate != null) return { status: "duplicate" as const };
      await tx.insert(loginEmails).values({
        userId: input.userId,
        email: input.newEmail,
        emailVerified: input.now,
        createdAt: input.now,
        updatedAt: input.now,
      });
      await tx.delete(emailChangeChallenges).where(eq(emailChangeChallenges.id, challenge.id));
      return { status: "verified" as const, email: input.newEmail };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { status: "duplicate" as const };
    throw error;
  }
}

/** Removes one login address; `last_email` refuses to leave the account with none. */
export async function removeLoginEmail(input: {
  userId: string;
  email: string;
  now: Date;
}): Promise<"removed" | "not_found" | "last_email"> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: loginEmails.id, email: loginEmails.email })
      .from(loginEmails)
      .where(eq(loginEmails.userId, input.userId))
      .for("update");
    if (rows.length <= 1) return "last_email" as const;
    const target = rows.find((row) => row.email === input.email);
    if (target == null) return "not_found" as const;
    await tx.delete(loginEmails).where(eq(loginEmails.id, target.id));
    // Removing an address must end every session that was opened with it; the
    // account signs in again with a passkey or a code sent to another address.
    await tx.update(users).set({ updatedAt: input.now }).where(eq(users.id, input.userId));
    await deleteUserSessions(input.userId, tx);
    return "removed" as const;
  });
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "23505";
}
