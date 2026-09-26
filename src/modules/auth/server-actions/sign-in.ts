"use server";

import crypto from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { AUTH_ERROR_CODES, AuthSignInError, type AuthErrorCode } from "@/modules/auth/errors";
import type { AuthenticatedPrincipal } from "@/modules/auth/contracts";
import { authenticateWithOTP } from "@/modules/auth/server/authenticate-with-otp";
import { authenticateWithPassword } from "@/modules/auth/server/authenticate-with-password";
import { authenticateDevUser } from "@/modules/auth/server/authenticate-dev-user";
import { completeInteractiveSignIn } from "@/modules/auth/server/complete-interactive-sign-in";
import { endSession, startSession } from "@/modules/auth/server/current-session";

export type SignInActionResult = { ok: true } | { ok: false; code: AuthErrorCode | "unexpected" };

const credentialsSchema = z.object({
  email: z.string().max(254),
  secret: z.string().max(128),
});

async function signInWith(
  authenticate: () => Promise<AuthenticatedPrincipal | null>
): Promise<SignInActionResult> {
  try {
    const principal = await authenticate();
    if (principal == null) return { ok: false, code: AUTH_ERROR_CODES.INVALID_CREDENTIALS };
    await completeInteractiveSignIn(principal);
    await startSession(principal.id);
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthSignInError) return { ok: false, code: error.code };
    logger.error(
      { error, correlationId: crypto.randomUUID(), errorCode: "SIGN_IN_FAILED" },
      "Sign-in failed"
    );
    return { ok: false, code: "unexpected" };
  }
}

function parseCredentials(email: unknown, secret: unknown) {
  return credentialsSchema.safeParse({ email, secret });
}

export async function signInWithOtpAction(email: string, otp: string): Promise<SignInActionResult> {
  const parsed = parseCredentials(email, otp);
  if (!parsed.success) return { ok: false, code: AUTH_ERROR_CODES.OTP_INVALID };
  const requestHeaders = await headers();
  return signInWith(() =>
    authenticateWithOTP({
      email: parsed.data.email,
      otp: parsed.data.secret,
      requestHeaders,
    })
  );
}

export async function signInWithPasswordAction(
  email: string,
  password: string
): Promise<SignInActionResult> {
  const parsed = parseCredentials(email, password);
  if (!parsed.success) return { ok: false, code: AUTH_ERROR_CODES.INVALID_CREDENTIALS };
  const requestHeaders = await headers();
  return signInWith(() =>
    authenticateWithPassword({
      email: parsed.data.email,
      password: parsed.data.secret,
      requestHeaders,
    })
  );
}

/** Local development only: `authenticateDevUser` returns null anywhere else. */
export async function devSignInAction(): Promise<SignInActionResult> {
  return signInWith(() => authenticateDevUser());
}

export async function signOutAction(): Promise<void> {
  await endSession();
}
