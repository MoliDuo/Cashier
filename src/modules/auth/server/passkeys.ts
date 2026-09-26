import "server-only";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { db } from "@/lib/db";
import { runtimeEnv } from "@/lib/env/runtime";
import { logger } from "@/lib/logger";
import { incrementRateLimit, rateLimitKey } from "@/lib/rate-limit";
import {
  AUTH_PASSKEY_IP_MAX_ATTEMPTS,
  AUTH_PASSWORD_RATE_LIMIT_WINDOW_SECONDS,
} from "@/config/tuning";
import { passkeys, webauthnChallenges } from "@/persistence";
import { AUTH_ERROR_CODES, AuthSignInError } from "@/modules/auth/errors";
import type { AuthenticatedPrincipal, PasskeySummary } from "@/modules/auth/contracts";
import { findUserById } from "./users";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function relyingParty() {
  const url = new URL(runtimeEnv.appUrl);
  return { rpID: url.hostname, origin: url.origin };
}

async function storeChallenge(input: {
  purpose: "register" | "login";
  userId: string | null;
  challenge: string;
  now: Date;
}): Promise<string> {
  const [row] = await db
    .insert(webauthnChallenges)
    .values({
      purpose: input.purpose,
      userId: input.userId,
      challenge: input.challenge,
      expiresAt: new Date(input.now.getTime() + CHALLENGE_TTL_MS),
      createdAt: input.now,
    })
    .returning({ id: webauthnChallenges.id });
  return row!.id;
}

/** Deletes and returns a live challenge, so each one finishes at most one ceremony. */
async function consumeChallenge(input: {
  id: string;
  purpose: "register" | "login";
  userId: string | null;
  now: Date;
}): Promise<string | null> {
  const [row] = await db
    .delete(webauthnChallenges)
    .where(
      and(
        eq(webauthnChallenges.id, input.id),
        eq(webauthnChallenges.purpose, input.purpose),
        input.userId == null
          ? isNull(webauthnChallenges.userId)
          : eq(webauthnChallenges.userId, input.userId),
        gt(webauthnChallenges.expiresAt, input.now)
      )
    )
    .returning({ challenge: webauthnChallenges.challenge });
  return row?.challenge ?? null;
}

export async function listPasskeys(userId: string): Promise<PasskeySummary[]> {
  const rows = await db
    .select({
      id: passkeys.id,
      name: passkeys.name,
      createdAt: passkeys.createdAt,
      lastUsedAt: passkeys.lastUsedAt,
      backedUp: passkeys.backedUp,
    })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .orderBy(asc(passkeys.createdAt), asc(passkeys.id));
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }));
}

/** Options for adding a passkey, excluding the ones the account already has. */
export async function startPasskeyRegistration(
  userId: string,
  now = new Date()
): Promise<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
  const user = await findUserById(userId);
  if (user == null) throw new AuthSignInError(AUTH_ERROR_CODES.INVALID_CREDENTIALS);
  const existing = await db
    .select({ id: passkeys.id, transports: passkeys.transports })
    .from(passkeys)
    .where(eq(passkeys.userId, userId));
  const { rpID } = relyingParty();
  const options = await generateRegistrationOptions({
    rpName: "Cashier",
    rpID,
    userName: user.email,
    userID: new TextEncoder().encode(userId),
    attestationType: "none",
    excludeCredentials: existing.map((row) => ({ id: row.id, transports: row.transports })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  const challengeId = await storeChallenge({
    purpose: "register",
    userId,
    challenge: options.challenge,
    now,
  });
  return { challengeId, options };
}

export type PasskeyRegistrationResult =
  | { ok: true; passkey: PasskeySummary }
  | { ok: false; reason: "expired" | "invalid" | "duplicate" };

export async function finishPasskeyRegistration(input: {
  userId: string;
  challengeId: string;
  response: RegistrationResponseJSON;
  name: string;
  now?: Date;
}): Promise<PasskeyRegistrationResult> {
  const now = input.now ?? new Date();
  const challenge = await consumeChallenge({
    id: input.challengeId,
    purpose: "register",
    userId: input.userId,
    now,
  });
  if (challenge == null) return { ok: false, reason: "expired" };

  const { rpID, origin } = relyingParty();
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (error) {
    logger.warn({ errorName: (error as Error).name }, "Passkey registration did not verify");
    return { ok: false, reason: "invalid" };
  }
  if (!verification.verified) return { ok: false, reason: "invalid" };

  const info = verification.registrationInfo;
  const [row] = await db
    .insert(passkeys)
    .values({
      id: info.credential.id,
      userId: input.userId,
      publicKey: isoBase64URL.fromBuffer(info.credential.publicKey),
      counter: info.credential.counter,
      transports: info.credential.transports ?? [],
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
      name: input.name,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (row == null) return { ok: false, reason: "duplicate" };
  return {
    ok: true,
    passkey: {
      id: row.id,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: null,
      backedUp: row.backedUp,
    },
  };
}

/**
 * Options for signing in with any passkey the browser holds for this site.
 * Each start stores a challenge, so starts are what the per-IP limit counts.
 */
export async function startPasskeySignIn(
  ip: string,
  now = new Date()
): Promise<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  let limit;
  try {
    limit = await incrementRateLimit(
      rateLimitKey("auth:passkey:ip", ip),
      AUTH_PASSKEY_IP_MAX_ATTEMPTS,
      AUTH_PASSWORD_RATE_LIMIT_WINDOW_SECONDS
    );
  } catch {
    throw new AuthSignInError(AUTH_ERROR_CODES.AUTH_RATE_LIMIT_UNAVAILABLE);
  }
  if (!limit.success) throw new AuthSignInError(AUTH_ERROR_CODES.PASSKEY_RATE_LIMITED);
  const { rpID } = relyingParty();
  const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });
  const challengeId = await storeChallenge({
    purpose: "login",
    userId: null,
    challenge: options.challenge,
    now,
  });
  return { challengeId, options };
}

/**
 * Checks a sign-in assertion. Every failure is the same `invalid_credentials`,
 * so a caller cannot tell an unknown passkey from a bad signature.
 */
export async function authenticateWithPasskey(input: {
  challengeId: string;
  response: AuthenticationResponseJSON;
  now?: Date;
}): Promise<AuthenticatedPrincipal> {
  const now = input.now ?? new Date();
  const rejected = new AuthSignInError(AUTH_ERROR_CODES.INVALID_CREDENTIALS);
  const challenge = await consumeChallenge({
    id: input.challengeId,
    purpose: "login",
    userId: null,
    now,
  });
  if (challenge == null) throw rejected;

  const passkey = await db.query.passkeys.findFirst({ where: eq(passkeys.id, input.response.id) });
  if (passkey == null) throw rejected;

  const { rpID, origin } = relyingParty();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: passkey.id,
        publicKey: isoBase64URL.toBuffer(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports,
      },
      requireUserVerification: false,
    });
  } catch (error) {
    logger.warn({ errorName: (error as Error).name }, "Passkey sign-in did not verify");
    throw rejected;
  }
  if (!verification.verified) throw rejected;

  // The counter only moves forward: a write that finds it moved past this
  // assertion lost a race with another sign-in by a cloned authenticator.
  const { newCounter, credentialBackedUp } = verification.authenticationInfo;
  const updated = await db
    .update(passkeys)
    .set({ counter: newCounter, backedUp: credentialBackedUp, lastUsedAt: now })
    .where(
      and(
        eq(passkeys.id, passkey.id),
        newCounter === 0 ? sql`true` : sql`${passkeys.counter} < ${newCounter}`
      )
    )
    .returning({ id: passkeys.id });
  if (updated.length === 0) throw rejected;

  const user = await findUserById(passkey.userId);
  if (user == null) throw rejected;
  return { id: user.id, email: user.email };
}

export async function renamePasskey(input: {
  userId: string;
  id: string;
  name: string;
}): Promise<boolean> {
  const rows = await db
    .update(passkeys)
    .set({ name: input.name })
    .where(and(eq(passkeys.id, input.id), eq(passkeys.userId, input.userId)))
    .returning({ id: passkeys.id });
  return rows.length === 1;
}

export async function deletePasskey(input: { userId: string; id: string }): Promise<boolean> {
  const rows = await db
    .delete(passkeys)
    .where(and(eq(passkeys.id, input.id), eq(passkeys.userId, input.userId)))
    .returning({ id: passkeys.id });
  return rows.length === 1;
}
