"use server";

import crypto from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import { logger } from "@/lib/logger";
import { AUTH_ERROR_CODES, AuthSignInError, type AuthErrorCode } from "@/modules/auth/errors";
import type { AuthenticatedPrincipal } from "@/modules/auth/contracts";
import { authenticateWithOTP } from "@/modules/auth/server/authenticate-with-otp";
import { authenticateDevUser } from "@/modules/auth/server/authenticate-dev-user";
import { completeInteractiveSignIn } from "@/modules/auth/server/complete-interactive-sign-in";
import { endSession, startSession } from "@/modules/auth/server/current-session";
import { authenticateWithPasskey, startPasskeySignIn } from "@/modules/auth/server/passkeys";
import { authenticationResponseSchema } from "@/modules/auth/contract-schemas";
import { getClientIPFromHeaders } from "@/lib/utils/ip";

export type SignInActionResult = { ok: true } | { ok: false; code: AuthErrorCode | "unexpected" };

const otpCredentialsSchema = z.object({
  email: z.string().max(254),
  otp: z.string().max(128),
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

export async function signInWithOtpAction(email: string, otp: string): Promise<SignInActionResult> {
  const parsed = otpCredentialsSchema.safeParse({ email, otp });
  if (!parsed.success) return { ok: false, code: AUTH_ERROR_CODES.OTP_INVALID };
  const requestHeaders = await headers();
  return signInWith(() =>
    authenticateWithOTP({
      email: parsed.data.email,
      otp: parsed.data.otp,
      requestHeaders,
    })
  );
}

export async function startPasskeySignInAction(): Promise<
  | { ok: true; challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }
  | { ok: false; code: AuthErrorCode | "unexpected" }
> {
  try {
    const ip = getClientIPFromHeaders(await headers());
    return { ok: true, ...(await startPasskeySignIn(ip)) };
  } catch (error) {
    if (error instanceof AuthSignInError) return { ok: false, code: error.code };
    logger.error(
      { error, correlationId: crypto.randomUUID(), errorCode: "PASSKEY_SIGN_IN_START_FAILED" },
      "Passkey sign-in could not start"
    );
    return { ok: false, code: "unexpected" };
  }
}

export async function finishPasskeySignInAction(
  challengeId: string,
  response: AuthenticationResponseJSON
): Promise<SignInActionResult> {
  const parsedId = z.uuid().safeParse(challengeId);
  const parsedResponse = authenticationResponseSchema.safeParse(response);
  if (!parsedId.success || !parsedResponse.success) {
    return { ok: false, code: AUTH_ERROR_CODES.INVALID_CREDENTIALS };
  }
  return signInWith(() =>
    authenticateWithPasskey({
      challengeId: parsedId.data,
      response: parsedResponse.data as AuthenticationResponseJSON,
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
