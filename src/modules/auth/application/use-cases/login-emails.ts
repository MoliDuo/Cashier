import type { AccountSecurityPort } from "../ports";
import type { EmailDeliveryPort } from "@/application/contracts";
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
import type { SupportedLocale } from "@/i18n/locales";
import { generateOTP, getOTPExpiration, hashOTP, isValidOTPFormat } from "../../services/otp";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";

/**
 * Adding a login address. This is the old "change email" flow with the new
 * meaning: nothing is replaced, the account just gains another address that can
 * sign in, and the OTP is what proves the address is reachable.
 */
export async function sendLoginEmailCode(
  input: {
    userId: string;
    newEmail: string;
    locale: SupportedLocale;
    host: string;
  },
  dependencies: { emailDelivery: EmailDeliveryPort; accounts: AccountSecurityPort }
) {
  const { userId, newEmail } = input;
  if (runtimeEnv.authResendKey == null)
    throw new ValidationError("Email delivery is not configured");

  const otp = generateOTP();
  const tokenHash = hashOTP(otp);
  const expiresAt = getOTPExpiration();
  const challenge = await dependencies.accounts.createEmailChangeChallenge({
    userId,
    newEmail,
    tokenHash,
    expiresAt,
    now: new Date(),
    minimumIntervalMs: 60_000,
  });
  if (challenge === "unauthorized") throw new UnauthorizedError();
  // Both "already on this account" and "on another account" report the same
  // refusal: which one it is, is not something the caller needs to know.
  if (challenge === "duplicate") throw new ConflictError("Email is already in use");
  if (challenge === "locked")
    throw new AppError("Verification is locked", "EMAIL_CHANGE_LOCKED", 429);
  if (challenge === "rate_limited") {
    throw new RateLimitError("Please wait before requesting another code", 60);
  }

  const zh = input.locale.startsWith("zh");
  try {
    const delivery = await dependencies.emailDelivery.send({
      from: runtimeEnv.authEmailFrom ?? DEFAULT_AUTH_EMAIL_FROM,
      to: newEmail,
      subject: zh ? "Cashier 验证码" : "Cashier verification code",
      content: OTPEmail({
        otp,
        host: input.host,
        expiresInMinutes: 5,
        locale: input.locale,
        copy: zh
          ? {
              preview: "添加登录邮箱",
              heading: "添加登录邮箱",
              intro: "输入以下验证码以把这个邮箱加入登录邮箱列表。",
              codeLabel: "验证码",
              expiry: "验证码将在 5 分钟后失效。",
              warning: "如果不是你发起的操作，请忽略此邮件。",
              footer: "Cashier 账户安全",
            }
          : {
              preview: "Add a login email",
              heading: "Add a login email",
              intro: "Enter this code to add this address to the sign-in list.",
              codeLabel: "Verification code",
              expiry: "This code expires in 5 minutes.",
              warning: "Ignore this email if you did not request this change.",
              footer: "Cashier account security",
            },
      }),
    });
    if (delivery !== "sent") throw new Error("Email provider did not accept the message");
  } catch {
    try {
      await dependencies.accounts.discardEmailChangeChallenge({ userId, newEmail, tokenHash });
    } catch (cleanupError) {
      logger.error(
        { error: cleanupError, subject: logIdentifier("user", userId) },
        "Failed to discard login email challenge after delivery failure"
      );
    }
    throw new AppError("Email delivery failed", "EMAIL_CHANGE_DELIVERY_FAILED", 502);
  }
  return { newEmail, expiresAt: expiresAt.getTime() };
}

export async function verifyLoginEmailCode(
  userId: string,
  newEmail: string,
  otp: string,
  accounts: AccountSecurityPort
) {
  if (!isValidOTPFormat(otp)) {
    throw new AppError("Invalid verification code", "EMAIL_CHANGE_INVALID_CODE", 400);
  }
  const outcome = await accounts.verifyEmailChangeChallenge({
    userId,
    newEmail,
    otp,
    now: new Date(),
  });
  if (outcome.status === "verified") return { email: outcome.email };
  if (outcome.status === "not_found") {
    throw new AppError("Verification challenge not found", "EMAIL_CHANGE_INVALID_CODE", 400);
  }
  if (outcome.status === "locked") {
    throw new AppError("Verification is locked", "EMAIL_CHANGE_LOCKED", 429);
  }
  if (outcome.status === "expired") {
    throw new AppError("Verification code expired", "EMAIL_CHANGE_EXPIRED_CODE", 400);
  }
  if (outcome.status === "duplicate") throw new ConflictError("Email is already in use");
  if (outcome.status !== "incorrect") throw new ValidationError("Verification failed");
  if (outcome.locked) {
    throw new AppError("Too many incorrect attempts", "EMAIL_CHANGE_LOCKED", 429);
  }
  throw new AppError("Incorrect verification code", "EMAIL_CHANGE_INVALID_CODE", 400, {
    attemptsRemaining: outcome.attemptsRemaining,
  });
}
