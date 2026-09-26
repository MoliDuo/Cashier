import "server-only";
import OTPEmail from "@/emails/otp-email";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { RateLimitError, AppError } from "@/lib/errors";
import { runtimeEnv } from "@/lib/env/runtime";
import { normalizeEmail, DEFAULT_AUTH_EMAIL_FROM } from "@/lib/utils/email";
import type { SendOTPEmail } from "@/modules/auth/contract-schemas";
import { sendEmail } from "@/lib/email-delivery";
import { createOtpToken, discardOtpToken, findOtpToken } from "./otp-tokens";
import { findUserByEmail } from "./users";
import {
  acquireResendCooldown,
  checkSendRateLimit,
  checkSendRateLimitByIP,
  releaseResendCooldown,
} from "./otp-rate-limit";
import { generateOTP, getResendCooldown } from "@/modules/auth/domain/otp";
import { OTP_EXPIRES_SECONDS } from "@/config/tuning";
import { signInCodeEmailCopy } from "@/copy/email";

function otpEmailCopy(host: string, expiresInMinutes: number) {
  const copy = signInCodeEmailCopy;
  return {
    preview: copy.preview,
    heading: copy.heading({ host }),
    intro: copy.intro,
    codeLabel: copy.codeLabel,
    expiry: copy.expiry({ minutes: expiresInMinutes }),
    warning: copy.warning,
    footer: copy.footer,
  };
}

export async function sendOTP(params: { email: SendOTPEmail; ip: string; host: string }): Promise<{
  expiresIn: number;
  expiresAt: number;
  canResendAt: number;
}> {
  const normalizedEmail = normalizeEmail(params.email);

  if (runtimeEnv.authResendKey == null) {
    throw new AppError("Email login is not configured", "EMAIL_NOT_CONFIGURED", 503);
  }

  const ipRateLimit = await checkSendRateLimitByIP(params.ip);
  if (!ipRateLimit.allowed) {
    throw new RateLimitError(
      "Too many requests from this IP. Please try again later.",
      ipRateLimit.retryAfter
    );
  }

  const emailRateLimit = await checkSendRateLimit(normalizedEmail);
  if (!emailRateLimit.allowed) {
    throw new RateLimitError(
      "Too many requests. Please try again later.",
      emailRateLimit.retryAfter
    );
  }

  const cooldown = await acquireResendCooldown(normalizedEmail);
  if (!cooldown.acquired) {
    throw new RateLimitError("Please wait before requesting another code", cooldown.retryAfter);
  }
  const canResendAt = Math.floor(cooldown.acquiredAt.getTime() / 1000) + getResendCooldown();

  // Unknown and locked-out addresses get the same answer as a real send, so
  // the response says nothing about which addresses exist. A locked-out one
  // gets no email either: a new code could not be used before the lock ends.
  const unsentResult = () => {
    const expiresAt = new Date(cooldown.acquiredAt.getTime() + OTP_EXPIRES_SECONDS * 1000);
    return {
      expiresIn: OTP_EXPIRES_SECONDS,
      expiresAt: Math.floor(expiresAt.getTime() / 1000),
      canResendAt,
    };
  };
  if ((await findUserByEmail(normalizedEmail)) == null) return unsentResult();
  const lockedUntil = (await findOtpToken(normalizedEmail))?.lockedUntil;
  if (lockedUntil != null && lockedUntil > cooldown.acquiredAt) {
    logger.info(
      { subject: logIdentifier("email", normalizedEmail) },
      "OTP email skipped while the address is locked out"
    );
    return unsentResult();
  }

  const otp = generateOTP();
  let tokenHash: string | undefined;
  let expiresAt: Date;

  try {
    const token = await createOtpToken(normalizedEmail, otp);
    expiresAt = token.expiresAt;
    tokenHash = token.tokenHash;
    const expiresInMinutes = Math.ceil(OTP_EXPIRES_SECONDS / 60);
    const delivery = await sendEmail({
      from: runtimeEnv.authEmailFrom ?? DEFAULT_AUTH_EMAIL_FROM,
      to: normalizedEmail,
      subject: signInCodeEmailCopy.subject,
      content: OTPEmail({
        otp,
        host: params.host,
        expiresInMinutes,
        copy: otpEmailCopy(params.host, expiresInMinutes),
      }),
    });
    if (delivery === "not_configured") {
      throw new AppError("Email login is not configured", "EMAIL_NOT_CONFIGURED", 503);
    } else {
      logger.info(
        { subject: logIdentifier("email", normalizedEmail) },
        "OTP email sent successfully"
      );
    }
  } catch (error) {
    if (tokenHash !== undefined) {
      await discardOtpToken(normalizedEmail, tokenHash).catch((discardError) => {
        logger.error(
          { error: discardError, subject: logIdentifier("email", normalizedEmail) },
          "Failed to discard OTP token after email failure"
        );
      });
    }
    await releaseResendCooldown(normalizedEmail, cooldown.acquiredAt).catch((releaseError) => {
      logger.error(
        { error: releaseError, subject: logIdentifier("email", normalizedEmail) },
        "Failed to release OTP resend cooldown after email failure"
      );
    });
    logger.error(
      { error, subject: logIdentifier("email", normalizedEmail) },
      "Failed to send OTP email"
    );
    if (error instanceof AppError && error.code === "EMAIL_NOT_CONFIGURED") {
      throw error;
    }
    throw new AppError("Failed to send verification code. Please try again.", "EMAIL_SEND_FAILED");
  }

  const expiresIn = Math.floor((expiresAt.getTime() - Date.now()) / 1000);

  return { expiresIn, expiresAt: Math.floor(expiresAt.getTime() / 1000), canResendAt };
}
