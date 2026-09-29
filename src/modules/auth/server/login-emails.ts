import "server-only";
import OTPEmail from "@/emails/otp-email";
import {
  AppError,
  ConflictError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from "@/lib/errors";
import { runtimeEnv } from "@/lib/env/runtime";
import { DEFAULT_AUTH_EMAIL_FROM } from "@/lib/utils/email";
import { sendEmail } from "@/lib/email-delivery";
import { generateOTP, getOTPExpiration, hashOTP, isValidOTPFormat } from "../domain/otp";
import { OTP_EXPIRES_SECONDS } from "@/config/tuning";
import {
  createLoginEmailChallenge,
  discardLoginEmailChallenge,
  verifyLoginEmailChallenge,
} from "./account-security";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { addLoginEmailCopy } from "@/copy/email";

const OTP_EXPIRES_MINUTES = Math.ceil(OTP_EXPIRES_SECONDS / 60);

/**
 * Adding a login address. This is the old "change email" flow with the new
 * meaning: nothing is replaced, the account just gains another address that can
 * sign in, and the OTP is what proves the address is reachable.
 */
export async function sendLoginEmailCode(input: { userId: string; newEmail: string }) {
  const { userId, newEmail } = input;
  if (runtimeEnv.authResendKey == null)
    throw new ValidationError("Email delivery is not configured");

  const otp = generateOTP();
  const codeHash = hashOTP(otp);
  const expiresAt = getOTPExpiration();
  const challenge = await createLoginEmailChallenge({
    userId,
    newEmail,
    codeHash,
    expiresAt,
    now: new Date(),
    minimumIntervalMs: 60_000,
  });
  if (challenge === "unauthorized") throw new UnauthorizedError();
  // Both "already on this account" and "on another account" report the same
  // refusal: which one it is, is not something the caller needs to know.
  if (challenge === "duplicate") throw new ConflictError("Email is already in use");
  if (challenge === "locked")
    throw new AppError("Verification is locked", "LOGIN_EMAIL_LOCKED", 429);
  if (challenge === "rate_limited") {
    throw new RateLimitError("Please wait before requesting another code", 60);
  }

  try {
    const delivery = await sendEmail({
      from: runtimeEnv.authEmailFrom ?? DEFAULT_AUTH_EMAIL_FROM,
      to: newEmail,
      subject: addLoginEmailCopy.subject({ code: otp }),
      content: OTPEmail({
        otp,
        copy: {
          preview: addLoginEmailCopy.preview({ code: otp, minutes: OTP_EXPIRES_MINUTES }),
          heading: addLoginEmailCopy.heading,
          note: addLoginEmailCopy.note({ minutes: OTP_EXPIRES_MINUTES }),
        },
      }),
    });
    if (delivery !== "sent") throw new Error("Email provider did not accept the message");
  } catch {
    try {
      await discardLoginEmailChallenge({ userId, newEmail, codeHash });
    } catch (cleanupError) {
      logger.error(
        { error: cleanupError, subject: logIdentifier("user", userId) },
        "Failed to discard login email challenge after delivery failure"
      );
    }
    throw new AppError("Email delivery failed", "LOGIN_EMAIL_DELIVERY_FAILED", 502);
  }
  return { newEmail, expiresAt: expiresAt.getTime() };
}

export async function verifyLoginEmailCode(userId: string, newEmail: string, otp: string) {
  if (!isValidOTPFormat(otp)) {
    throw new AppError("Invalid verification code", "LOGIN_EMAIL_INVALID_CODE", 400);
  }
  const outcome = await verifyLoginEmailChallenge({
    userId,
    newEmail,
    otp,
    now: new Date(),
  });
  if (outcome.status === "verified") return { email: outcome.email };
  if (outcome.status === "not_found") {
    throw new AppError("Verification challenge not found", "LOGIN_EMAIL_INVALID_CODE", 400);
  }
  if (outcome.status === "locked") {
    throw new AppError("Verification is locked", "LOGIN_EMAIL_LOCKED", 429);
  }
  if (outcome.status === "expired") {
    throw new AppError("Verification code expired", "LOGIN_EMAIL_EXPIRED_CODE", 400);
  }
  if (outcome.status === "duplicate") throw new ConflictError("Email is already in use");
  if (outcome.status !== "incorrect") throw new ValidationError("Verification failed");
  if (outcome.locked) {
    throw new AppError("Too many incorrect attempts", "LOGIN_EMAIL_LOCKED", 429);
  }
  throw new AppError("Incorrect verification code", "LOGIN_EMAIL_INVALID_CODE", 400, {
    attemptsRemaining: outcome.attemptsRemaining,
  });
}
