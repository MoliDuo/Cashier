"use server";

import crypto from "node:crypto";
import { requireAuth } from "@/modules/auth/server/session-guards";
import { ConflictError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { parseLoginEmail } from "@/modules/auth/contract-schemas";
import { addLoginEmail, removeLoginEmail } from "@/modules/auth/server/login-emails";
import { listLoginEmails } from "@/modules/auth/server/users";

export type LoginEmailErrorCode = "invalid_email" | "email_in_use" | "last_email" | "unknown";

export type LoginEmailsActionResult =
  { ok: true; emails: string[] } | { ok: false; code: LoginEmailErrorCode };

function mapError(error: unknown): LoginEmailErrorCode {
  if (error instanceof ConflictError) return "email_in_use";
  if (error instanceof ValidationError && Array.isArray(error.details?.issues)) {
    return "invalid_email";
  }
  return "unknown";
}

function failed(error: unknown, errorCode: string, message: string): LoginEmailsActionResult {
  const code = mapError(error);
  if (code === "unknown") {
    logger.error({ correlationId: crypto.randomUUID(), errorCode }, message);
  }
  return { ok: false, code };
}

async function emailsOf(userId: string): Promise<string[]> {
  return (await listLoginEmails(userId)).map((row) => row.email);
}

/** Lets the person the identity provider knows by this address sign in. */
export async function addLoginEmailAction(inputEmail: string): Promise<LoginEmailsActionResult> {
  try {
    const userId = await requireAuth();
    await addLoginEmail({ userId, email: parseLoginEmail(inputEmail) });
    return { ok: true, emails: await emailsOf(userId) };
  } catch (error) {
    return failed(error, "LOGIN_EMAIL_ADD_FAILED", "Adding a login email failed");
  }
}

export async function removeLoginEmailAction(inputEmail: string): Promise<LoginEmailsActionResult> {
  try {
    const userId = await requireAuth();
    const result = await removeLoginEmail({
      userId,
      email: parseLoginEmail(inputEmail),
      now: new Date(),
    });
    if (result === "last_email") return { ok: false, code: "last_email" };
    if (result === "not_found") return { ok: false, code: "unknown" };
    return { ok: true, emails: await emailsOf(userId) };
  } catch (error) {
    return failed(error, "LOGIN_EMAIL_REMOVE_FAILED", "Login email removal failed");
  }
}
