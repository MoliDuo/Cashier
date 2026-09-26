"use server";

import crypto from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { logger } from "@/lib/logger";
import { getClientIPFromHeaders } from "@/lib/utils/ip";
import { AUTH_ERROR_CODES, AuthSignInError } from "@/modules/auth/errors";
import { PASSKEY_NAME_MAX_LENGTH } from "@/modules/auth/constants";
import { registrationResponseSchema } from "@/modules/auth/contract-schemas";
import { completeInteractiveSignIn } from "@/modules/auth/server/complete-interactive-sign-in";
import { startSession } from "@/modules/auth/server/current-session";
import {
  enrollmentTokenSchema,
  finishEnrollment,
  startEnrollment,
} from "@/modules/auth/server/enrollment";
import { findUserById } from "@/modules/auth/server/users";

export type EnrollActionErrorCode =
  | "invalid_link"
  | "expired"
  | "invalid"
  | "duplicate"
  | "rate_limited"
  | "rate_limit_unavailable"
  | "unexpected";

type Failure = { ok: false; code: EnrollActionErrorCode };

const nameSchema = z.string().trim().min(1).max(PASSKEY_NAME_MAX_LENGTH);

function failure(error: unknown, action: string): Failure {
  if (error instanceof AuthSignInError) {
    if (error.code === AUTH_ERROR_CODES.PASSKEY_RATE_LIMITED) {
      return { ok: false, code: "rate_limited" };
    }
    if (error.code === AUTH_ERROR_CODES.AUTH_RATE_LIMIT_UNAVAILABLE) {
      return { ok: false, code: "rate_limit_unavailable" };
    }
  }
  logger.error(
    { correlationId: crypto.randomUUID(), errorCode: "ENROLLMENT_FAILED", action },
    "Passkey enrollment failed"
  );
  return { ok: false, code: "unexpected" };
}

/** Registration options for the account an `account:enroll` link names. */
export async function startEnrollmentAction(
  token: string
): Promise<
  { ok: true; challengeId: string; options: PublicKeyCredentialCreationOptionsJSON } | Failure
> {
  const parsed = enrollmentTokenSchema.safeParse(token);
  if (!parsed.success) return { ok: false, code: "invalid_link" };
  try {
    const ip = getClientIPFromHeaders(await headers());
    const started = await startEnrollment(parsed.data, ip);
    return started == null ? { ok: false, code: "invalid_link" } : { ok: true, ...started };
  } catch (error) {
    return failure(error, "start");
  }
}

/** Stores the passkey, spends the link, and signs this browser in. */
export async function finishEnrollmentAction(
  token: string,
  challengeId: string,
  response: RegistrationResponseJSON,
  name: string
): Promise<{ ok: true } | Failure> {
  const parsedToken = enrollmentTokenSchema.safeParse(token);
  if (!parsedToken.success) return { ok: false, code: "invalid_link" };
  const parsedId = z.uuid().safeParse(challengeId);
  const parsedResponse = registrationResponseSchema.safeParse(response);
  const parsedName = nameSchema.safeParse(name);
  if (!parsedId.success || !parsedResponse.success || !parsedName.success) {
    return { ok: false, code: "invalid" };
  }
  try {
    const result = await finishEnrollment({
      token: parsedToken.data,
      challengeId: parsedId.data,
      response: parsedResponse.data as RegistrationResponseJSON,
      name: parsedName.data,
    });
    if (!result.ok) return { ok: false, code: result.reason };
    const user = await findUserById(result.userId);
    if (user == null) return { ok: false, code: "invalid_link" };
    await completeInteractiveSignIn(user);
    await startSession(user.id);
    return { ok: true };
  } catch (error) {
    return failure(error, "finish");
  }
}
