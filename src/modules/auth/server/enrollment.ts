import "server-only";
import crypto from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { incrementRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { keyedDigest } from "@/lib/security/keys";
import {
  AUTH_PASSKEY_IP_MAX_ATTEMPTS,
  AUTH_PASSKEY_RATE_LIMIT_WINDOW_SECONDS,
} from "@/config/tuning";
import { webauthnChallenges } from "@/persistence";
import { AUTH_ERROR_CODES, AuthSignInError } from "@/modules/auth/errors";
import { finishPasskeyRegistration, startPasskeyRegistration } from "./passkeys";
import { findUserByEmail } from "./users";

/** How long a link printed by `account:enroll` stays usable. */
export const ENROLLMENT_TTL_MS = 30 * 60 * 1000;

/** 32 random bytes in base64url, the only shape an enrollment token has. */
export const enrollmentTokenSchema = z.string().regex(/^[\w-]{43}$/);

function hashEnrollmentToken(token: string): string {
  return keyedDigest("enrollment", token);
}

function liveEnrollment(token: string, now: Date) {
  return and(
    eq(webauthnChallenges.purpose, "enroll"),
    eq(webauthnChallenges.challenge, hashEnrollmentToken(token)),
    gt(webauthnChallenges.expiresAt, now)
  );
}

/**
 * Issues the one-time link that adds a passkey to the account signing in with
 * `email`, replacing any link issued before. Only the token's keyed digest is
 * stored, so the plaintext exists only in the caller's hands. Null when no
 * account signs in with that address.
 */
export async function issueEnrollmentToken(
  email: string,
  now = new Date()
): Promise<{ token: string; expiresAt: Date } | null> {
  const user = await findUserByEmail(email);
  if (user == null) return null;
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + ENROLLMENT_TTL_MS);
  await db.transaction(async (tx) => {
    await tx
      .delete(webauthnChallenges)
      .where(and(eq(webauthnChallenges.purpose, "enroll"), eq(webauthnChallenges.userId, user.id)));
    await tx.insert(webauthnChallenges).values({
      purpose: "enroll",
      userId: user.id,
      challenge: hashEnrollmentToken(token),
      expiresAt,
      createdAt: now,
    });
  });
  return { token, expiresAt };
}

/** The account a live, unused token enrolls for, or null. */
export async function findEnrollmentUser(token: string, now = new Date()): Promise<string | null> {
  const [row] = await db
    .select({ userId: webauthnChallenges.userId })
    .from(webauthnChallenges)
    .where(liveEnrollment(token, now))
    .limit(1);
  return row?.userId ?? null;
}

/**
 * Registration options for the token's account. The token is not spent here:
 * a dismissed browser prompt must not cost the operator a new link.
 */
export async function startEnrollment(
  token: string,
  ip: string,
  now = new Date()
): Promise<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON } | null> {
  let limit;
  try {
    limit = await incrementRateLimit(
      rateLimitKey("auth:enroll:ip", ip),
      AUTH_PASSKEY_IP_MAX_ATTEMPTS,
      AUTH_PASSKEY_RATE_LIMIT_WINDOW_SECONDS
    );
  } catch {
    throw new AuthSignInError(AUTH_ERROR_CODES.AUTH_RATE_LIMIT_UNAVAILABLE);
  }
  if (!limit.success) throw new AuthSignInError(AUTH_ERROR_CODES.PASSKEY_RATE_LIMITED);
  const userId = await findEnrollmentUser(token, now);
  if (userId == null) return null;
  return startPasskeyRegistration(userId, now);
}

export type EnrollmentResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid_link" | "expired" | "invalid" | "duplicate" };

/**
 * Stores the passkey and spends the token in one transaction. The token's row
 * is locked first, so of two finishes racing on one link exactly one commits a
 * passkey; a failed ceremony spends only its registration challenge and leaves
 * the link usable until it expires.
 */
export async function finishEnrollment(input: {
  token: string;
  challengeId: string;
  response: RegistrationResponseJSON;
  name: string;
  now?: Date;
}): Promise<EnrollmentResult> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [enrollment] = await tx
      .select({ id: webauthnChallenges.id, userId: webauthnChallenges.userId })
      .from(webauthnChallenges)
      .where(liveEnrollment(input.token, now))
      .for("update");
    if (enrollment?.userId == null) return { ok: false, reason: "invalid_link" };

    const registered = await finishPasskeyRegistration(
      {
        userId: enrollment.userId,
        challengeId: input.challengeId,
        response: input.response,
        name: input.name,
        now,
      },
      tx
    );
    if (!registered.ok) return { ok: false, reason: registered.reason };

    await tx.delete(webauthnChallenges).where(eq(webauthnChallenges.id, enrollment.id));
    return { ok: true, userId: enrollment.userId };
  });
}
