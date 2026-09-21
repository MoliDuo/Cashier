"use server";
import { headers } from "next/headers";
import { getClientIPFromHeaders } from "@/lib/utils/ip";
import { sendOTP } from "@/modules/auth/application/use-cases/send-otp";
import { AppError, RateLimitError } from "@/lib/errors";
import { parseSendOTPEmail } from "../contract-schemas";
import { serverComposition } from "@/application/server-composition-root";

export type SendOTPActionResult =
  | {
      ok: true;
      expiresIn: number;
      expiresAt: number;
      canResendAt: number;
    }
  | {
      ok: false;
      code:
        | "rate_limited"
        | "rate_limit_unavailable"
        | "invalid_email"
        | "email_not_configured"
        | "email_send_failed"
        | "config_error"
        | "unexpected";
      retryAfter?: number;
    };

function sendOTPFailure(error: unknown): SendOTPActionResult {
  if (error instanceof RateLimitError) {
    return {
      ok: false,
      code: "rate_limited",
      ...(error.retryAfter === undefined ? {} : { retryAfter: error.retryAfter }),
    };
  }

  if (error instanceof AppError) {
    if (error.code === "AUTH_RATE_LIMIT_UNAVAILABLE") {
      return { ok: false, code: "rate_limit_unavailable" };
    }
    // A misconfigured env var (a bad AUTH_RATE_LIMIT_MAX, say) is a distinct
    // failure from "the rate limiter
    // backend is unavailable" or "something unexpected happened" — surface
    // it as its own code instead of letting it fall through to "unexpected".
    if (error.code === "STARTUP_ENV_INVALID") {
      return { ok: false, code: "config_error" };
    }
    switch (error.code) {
      case "VALIDATION_ERROR":
        return { ok: false, code: "invalid_email" };
      case "EMAIL_NOT_CONFIGURED":
        return { ok: false, code: "email_not_configured" };
      case "EMAIL_SEND_FAILED":
        return { ok: false, code: "email_send_failed" };
    }
  }

  return { ok: false, code: "unexpected" };
}

export async function sendOTPAction(email: string): Promise<SendOTPActionResult> {
  try {
    const validatedEmail = parseSendOTPEmail(email);
    const requestHeaders = await headers();
    const result = await sendOTP(
      {
        email: validatedEmail,
        ip: getClientIPFromHeaders(requestHeaders),
        host: requestHeaders.get("host") ?? "localhost",
      },
      {
        emailDelivery: serverComposition.email,
        tokens: serverComposition.otpTokens,
        users: serverComposition.userAccounts,
        rateLimiter: serverComposition.rateLimiter,
      }
    );
    return { ok: true, ...result };
  } catch (error) {
    return sendOTPFailure(error);
  }
}
