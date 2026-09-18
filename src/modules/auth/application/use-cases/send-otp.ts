import OTPEmail from "@/emails/otp-email";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { RateLimitError, AppError } from "@/lib/errors";
import { runtimeEnv } from "@/lib/env/runtime";
import { normalizeEmail, DEFAULT_AUTH_EMAIL_FROM } from "@/lib/utils/email";
import type { SupportedLocale } from "@/i18n/locales";
import { DEFAULT_LOCALE } from "@/i18n/locales";
import type { SendOTPEmail } from "@/modules/auth/contract-schemas";
import { createOTPToken, discardOTPToken } from "@/modules/auth/repositories/otp-repository";
import {
  acquireResendCooldown,
  checkSendRateLimit,
  checkSendRateLimitByIP,
  releaseResendCooldown,
} from "@/modules/auth/services/otp-rate-limit";
import { generateOTP, getResendCooldown } from "@/modules/auth/services/otp";
import type { EmailDeliveryPort, OtpTokenPort, UserAccountPort } from "@/application/contracts";
import type { RateLimiterPort } from "@/application/contracts";

type OTPAuthEmailMessages = {
  otpSubject: string;
  otpPreview: string;
  otpHeading: string;
  otpIntro: string;
  otpCodeLabel: string;
  otpExpiry: string;
  otpWarning: string;
  otpFooter: string;
};

async function getOTPEmailCopy(
  locale: SupportedLocale,
  host: string,
  otp: string,
  expiresInMinutes: number
) {
  const messages = (await import(`../../../../../messages/${locale}.json`)).default as {
    AuthEmail: OTPAuthEmailMessages;
  };
  const t = messages.AuthEmail;
  return {
    subject: locale.startsWith("zh") ? "Cashier 验证码" : "Cashier verification code",
    copy: {
      preview: t.otpPreview,
      heading: t.otpHeading.replace("{host}", host),
      intro: t.otpIntro,
      codeLabel: t.otpCodeLabel,
      expiry: t.otpExpiry.replace("{minutes}", String(expiresInMinutes)),
      warning: t.otpWarning,
      footer: t.otpFooter,
    },
  };
}

export async function sendOTP(
  params: {
    email: SendOTPEmail;
    ip: string;
    host: string;
    locale?: SupportedLocale;
  },
  dependencies: {
    emailDelivery: EmailDeliveryPort;
    tokens: OtpTokenPort;
    users: UserAccountPort;
    rateLimiter: RateLimiterPort;
  }
): Promise<{
  expiresIn: number;
  expiresAt: number;
  canResendAt: number;
}> {
  const normalizedEmail = normalizeEmail(params.email);

  if (runtimeEnv.authResendKey == null) {
    throw new AppError("Email login is not configured", "EMAIL_NOT_CONFIGURED", 503);
  }

  const ipRateLimit = await checkSendRateLimitByIP(params.ip, dependencies.rateLimiter);
  if (!ipRateLimit.allowed) {
    throw new RateLimitError(
      "Too many requests from this IP. Please try again later.",
      ipRateLimit.retryAfter
    );
  }

  const emailRateLimit = await checkSendRateLimit(normalizedEmail, dependencies.rateLimiter);
  if (!emailRateLimit.allowed) {
    throw new RateLimitError(
      "Too many requests. Please try again later.",
      emailRateLimit.retryAfter
    );
  }

  const cooldown = await acquireResendCooldown(normalizedEmail, dependencies.rateLimiter);
  if (!cooldown.acquired) {
    throw new RateLimitError("Please wait before requesting another code", cooldown.retryAfter);
  }
  const canResendAt = Math.floor(cooldown.acquiredAt.getTime() / 1000) + getResendCooldown();

  if ((await dependencies.users.findByEmail(normalizedEmail)) == null) {
    const expiresAt = new Date(cooldown.acquiredAt.getTime() + runtimeEnv.otpExpiresSeconds * 1000);
    return {
      expiresIn: runtimeEnv.otpExpiresSeconds,
      expiresAt: Math.floor(expiresAt.getTime() / 1000),
      canResendAt,
    };
  }

  const otp = generateOTP();
  let tokenHash: string | undefined;
  let expiresAt: Date;

  try {
    const token = await createOTPToken(
      normalizedEmail,
      otp,
      dependencies.tokens,
      params.ip === "unknown" ? undefined : params.ip
    );
    expiresAt = token.expiresAt;
    tokenHash = token.tokenHash;
    const locale = params.locale ?? DEFAULT_LOCALE;
    const expiresInMinutes = Math.ceil(runtimeEnv.otpExpiresSeconds / 60);
    const { subject, copy } = await getOTPEmailCopy(locale, params.host, otp, expiresInMinutes);
    const delivery = await dependencies.emailDelivery.send({
      from: runtimeEnv.authEmailFrom ?? DEFAULT_AUTH_EMAIL_FROM,
      to: normalizedEmail,
      subject,
      content: OTPEmail({ otp, host: params.host, expiresInMinutes, locale, copy }),
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
      await discardOTPToken(normalizedEmail, tokenHash, dependencies.tokens).catch(
        (discardError) => {
          logger.error(
            { error: discardError, subject: logIdentifier("email", normalizedEmail) },
            "Failed to discard OTP token after email failure"
          );
        }
      );
    }
    await releaseResendCooldown(
      normalizedEmail,
      cooldown.acquiredAt,
      dependencies.rateLimiter
    ).catch((releaseError) => {
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
