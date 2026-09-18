"use server";

import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { auth } from "@/auth";
import { requireRecentAuth } from "@/lib/auth-actions";
import { resolveSupportedLocale } from "@/i18n/resolve-locale";
import { ConflictError, RateLimitError, UnauthorizedError, ValidationError } from "@/lib/errors";
import { AppError } from "@/lib/errors";
import { normalizeEmail } from "@/lib/utils/email";
import { logger } from "@/lib/logger";
import { parseSendOTPEmail } from "@/modules/auth/contract-schemas";
import {
  sendLoginEmailCode,
  verifyLoginEmailCode,
} from "@/modules/auth/application/use-cases/login-emails";
import { serverComposition } from "@/application/server-composition-root";
import { AUTH_ERROR_CODES } from "@/modules/auth/errors";

export type LoginEmailErrorCode =
  | "invalid_email"
  | "reauth_required"
  | "invalid_code"
  | "expired_code"
  | "email_in_use"
  | "rate_limited"
  | "locked"
  | "last_email"
  | "unknown";

export type SendLoginEmailCodeActionResult =
  { ok: true; expiresAt: number } | { ok: false; code: LoginEmailErrorCode };

export type LoginEmailsActionResult =
  { ok: true; emails: string[]; verified: boolean } | { ok: false; code: LoginEmailErrorCode };

export type RemoveLoginEmailActionResult =
  { ok: true; emails: string[] } | { ok: false; code: LoginEmailErrorCode };

async function requireUserId(): Promise<string> {
  const session = await auth();
  const userId = session?.user?.id;
  if (userId == null || userId === "") throw new UnauthorizedError();
  return userId;
}

function mapError(error: unknown): LoginEmailErrorCode {
  if (error instanceof AppError && error.code === AUTH_ERROR_CODES.REAUTHENTICATION_REQUIRED) {
    return "reauth_required";
  }
  if (error instanceof ConflictError) return "email_in_use";
  if (error instanceof ValidationError && Array.isArray(error.details?.issues)) {
    return "invalid_email";
  }
  if (error instanceof RateLimitError) return "rate_limited";
  if (error instanceof AppError) {
    switch (error.code) {
      case "EMAIL_CHANGE_LOCKED":
        return "locked";
      case "EMAIL_CHANGE_EXPIRED_CODE":
        return "expired_code";
      case "EMAIL_CHANGE_INVALID_CODE":
        return "invalid_code";
      case "LOGIN_EMAIL_LAST":
        return "last_email";
    }
  }
  return "unknown";
}

/** The account's login addresses, for the 设置 list. */
export const listLoginEmailsAction = async (): Promise<string[]> => {
  const userId = await requireUserId();
  return (await serverComposition.userAccounts.listLoginEmails(userId)).map((row) => row.email);
};

/** Sends an OTP to an address that is not yet a login address. */
export async function sendLoginEmailCodeAction(
  inputEmail: string,
  locale?: string
): Promise<SendLoginEmailCodeActionResult> {
  try {
    const userId = await requireRecentAuth();
    const newEmail = normalizeEmail(parseSendOTPEmail(inputEmail));
    const [requestHeaders, cookieStore] = await Promise.all([headers(), cookies()]);
    const resolvedLocale = resolveSupportedLocale({
      explicitLocale: locale ?? null,
      cookieLocale: cookieStore.get("NEXT_LOCALE")?.value ?? null,
      acceptLanguage: requestHeaders.get("accept-language"),
    });
    const result = await sendLoginEmailCode(
      {
        userId,
        newEmail,
        locale: resolvedLocale,
        host: requestHeaders.get("host") ?? "Cashier",
      },
      { emailDelivery: serverComposition.email, accounts: serverComposition.accountSecurity }
    );
    return { ok: true, expiresAt: result.expiresAt };
  } catch (error) {
    const code = mapError(error);
    if (code === "unknown") {
      logger.error(
        { correlationId: crypto.randomUUID(), errorCode: "LOGIN_EMAIL_SEND_FAILED" },
        "Login email code request failed"
      );
    }
    return { ok: false, code };
  }
}

/** Confirms the code and adds the address to the account. */
export async function verifyLoginEmailCodeAction(
  inputEmail: string,
  otp: string
): Promise<LoginEmailsActionResult> {
  try {
    const userId = await requireUserId();
    const newEmail = normalizeEmail(parseSendOTPEmail(inputEmail));
    await verifyLoginEmailCode(userId, newEmail, otp, serverComposition.accountSecurity);
    const emails = (await serverComposition.userAccounts.listLoginEmails(userId)).map(
      (row) => row.email
    );
    return { ok: true, emails, verified: true };
  } catch (error) {
    const code = mapError(error);
    if (code === "unknown") {
      logger.error(
        { correlationId: crypto.randomUUID(), errorCode: "LOGIN_EMAIL_VERIFY_FAILED" },
        "Login email verification failed"
      );
    }
    return { ok: false, code };
  }
}

export async function removeLoginEmailAction(
  inputEmail: string
): Promise<RemoveLoginEmailActionResult> {
  try {
    const userId = await requireRecentAuth();
    const email = normalizeEmail(parseSendOTPEmail(inputEmail));
    const result = await serverComposition.accountSecurity.removeLoginEmail({
      userId,
      email,
      now: new Date(),
    });
    if (result === "last_email") return { ok: false, code: "last_email" };
    if (result === "not_found") return { ok: false, code: "unknown" };
    const emails = (await serverComposition.userAccounts.listLoginEmails(userId)).map(
      (row) => row.email
    );
    return { ok: true, emails };
  } catch (error) {
    const code = mapError(error);
    if (code === "unknown") {
      logger.error(
        { correlationId: crypto.randomUUID(), errorCode: "LOGIN_EMAIL_REMOVE_FAILED" },
        "Login email removal failed"
      );
    }
    return { ok: false, code };
  }
}
