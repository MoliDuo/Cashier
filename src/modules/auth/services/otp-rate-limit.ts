import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { RateLimitUnavailableError } from "@/lib/errors";
import { getResendCooldown } from "./otp";
import type { RateLimiterPort } from "@/application/contracts";
import { createHash } from "node:crypto";
import {
  AUTH_RATE_LIMIT_MAX,
  AUTH_RATE_LIMIT_WINDOW_SECONDS,
  OTP_IP_MAX_ATTEMPTS_PER_HOUR,
  OTP_VERIFY_MAX_ATTEMPTS_PER_MINUTE,
} from "@/config/tuning";

const OTP_SEND_PREFIX = "otp:send:";
const OTP_SEND_IP_PREFIX = "otp:send:ip:";
const OTP_RESEND_PREFIX = "otp:resend:";
const OTP_VERIFY_PREFIX = "otp:verify:";

const IP_WINDOW_SECONDS = 60 * 60;
const VERIFY_WINDOW_SECONDS = 60;

// The digest is unkeyed on purpose. It bounds the key's length and keeps raw
// addresses out of `rate_limit_buckets`; it is not hiding anything, because the
// same database stores the login emails in plain text two tables over.
function bucketKey(purpose: string, identifier: string): string {
  const digest = createHash("sha256").update(identifier.trim().toLowerCase()).digest("hex");
  return `${purpose}:${digest}`;
}

export async function checkSendRateLimit(
  email: string,
  rateLimiter: RateLimiterPort
): Promise<{
  allowed: boolean;
  remainingAttempts: number;
  retryAfter?: number;
}> {
  const key = bucketKey(OTP_SEND_PREFIX.slice(0, -1), email);
  try {
    const result = await rateLimiter.increment(
      key,
      AUTH_RATE_LIMIT_MAX,
      AUTH_RATE_LIMIT_WINDOW_SECONDS
    );

    if (!result.success) {
      const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
      logger.warn(
        { subject: logIdentifier("email", email), attempts: AUTH_RATE_LIMIT_MAX + 1 },
        "OTP send rate limit exceeded for email"
      );
      return {
        allowed: false,
        remainingAttempts: 0,
        retryAfter: retryAfter > 0 ? retryAfter : AUTH_RATE_LIMIT_WINDOW_SECONDS,
      };
    }

    return {
      allowed: true,
      remainingAttempts: result.remaining,
    };
  } catch (error) {
    logger.error(
      { error, subject: logIdentifier("email", email), purpose: "send" },
      "OTP send rate limit check failed"
    );
    throw new RateLimitUnavailableError();
  }
}

export async function checkSendRateLimitByIP(
  ip: string,
  rateLimiter: RateLimiterPort
): Promise<{
  allowed: boolean;
  remainingAttempts: number;
  retryAfter?: number;
}> {
  const key = bucketKey(OTP_SEND_IP_PREFIX.slice(0, -1), ip);
  try {
    const result = await rateLimiter.increment(
      key,
      OTP_IP_MAX_ATTEMPTS_PER_HOUR,
      IP_WINDOW_SECONDS
    );

    if (!result.success) {
      const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
      logger.warn(
        { subject: logIdentifier("ip", ip), attempts: OTP_IP_MAX_ATTEMPTS_PER_HOUR + 1 },
        "OTP send rate limit exceeded for IP"
      );
      return {
        allowed: false,
        remainingAttempts: 0,
        retryAfter: retryAfter > 0 ? retryAfter : IP_WINDOW_SECONDS,
      };
    }

    return {
      allowed: true,
      remainingAttempts: result.remaining,
    };
  } catch (error) {
    logger.error(
      { error, subject: logIdentifier("ip", ip), purpose: "send_ip" },
      "OTP send IP rate limit check failed"
    );
    throw new RateLimitUnavailableError();
  }
}

export async function acquireResendCooldown(
  email: string,
  rateLimiter: RateLimiterPort
): Promise<{
  acquired: boolean;
  acquiredAt: Date;
  retryAfter: number;
}> {
  const key = bucketKey(OTP_RESEND_PREFIX.slice(0, -1), email);
  const cooldownSeconds = getResendCooldown();
  try {
    return await rateLimiter.acquireCooldown(key, cooldownSeconds);
  } catch (error) {
    logger.error(
      { error, subject: logIdentifier("email", email), purpose: "resend_cooldown" },
      "OTP resend cooldown check failed"
    );
    throw new RateLimitUnavailableError();
  }
}

export async function releaseResendCooldown(
  email: string,
  acquiredAt: Date,
  rateLimiter: RateLimiterPort
): Promise<boolean> {
  const key = bucketKey(OTP_RESEND_PREFIX.slice(0, -1), email);
  return rateLimiter.releaseCooldown(key, acquiredAt);
}

export async function checkVerifyRateLimit(
  ip: string,
  rateLimiter: RateLimiterPort
): Promise<boolean> {
  const key = bucketKey(OTP_VERIFY_PREFIX.slice(0, -1), ip);
  try {
    const result = await rateLimiter.increment(
      key,
      OTP_VERIFY_MAX_ATTEMPTS_PER_MINUTE,
      VERIFY_WINDOW_SECONDS
    );

    if (!result.success) {
      logger.warn(
        { subject: logIdentifier("ip", ip), attempts: OTP_VERIFY_MAX_ATTEMPTS_PER_MINUTE + 1 },
        "OTP verify rate limit exceeded for IP"
      );
      return false;
    }

    return true;
  } catch (error) {
    logger.error(
      { error, subject: logIdentifier("ip", ip), purpose: "verify" },
      "OTP verify rate limit check failed"
    );
    throw new RateLimitUnavailableError();
  }
}
