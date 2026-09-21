import { runtimeEnv } from "@/lib/env/runtime";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { RateLimitUnavailableError } from "@/lib/errors";
import { getResendCooldown } from "./otp";
import type { RateLimiterPort } from "@/application/contracts";
import { createHash } from "node:crypto";

// Config reads below (bucketKey and the getXxx() helpers) touch runtimeEnv
// getters, which re-validate on every access and can throw
// AppError("STARTUP_ENV_INVALID", ...). Every call site keeps those reads
// outside its try/catch so a misconfigured env var is never swallowed and
// relabeled as RateLimitUnavailableError ("sign-in protection is temporarily
// unavailable") — that message must mean the rate limiter backend actually
// failed, not that config is broken.

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

function getSendMaxAttempts(): number {
  return runtimeEnv.authRateLimitMax;
}

function getSendWindowSeconds(): number {
  return runtimeEnv.authRateLimitWindow;
}

function getIpMaxAttempts(): number {
  return runtimeEnv.otpIpMaxAttemptsPerHour;
}

function getVerifyMaxAttempts(): number {
  return runtimeEnv.otpVerifyMaxAttemptsPerMinute;
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
  const sendWindowSeconds = getSendWindowSeconds();
  const sendMaxAttempts = getSendMaxAttempts();
  try {
    const result = await rateLimiter.increment(key, sendMaxAttempts, sendWindowSeconds);

    if (!result.success) {
      const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
      logger.warn(
        { subject: logIdentifier("email", email), attempts: sendMaxAttempts + 1 },
        "OTP send rate limit exceeded for email"
      );
      return {
        allowed: false,
        remainingAttempts: 0,
        retryAfter: retryAfter > 0 ? retryAfter : sendWindowSeconds,
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
  const ipMaxAttempts = getIpMaxAttempts();
  try {
    const result = await rateLimiter.increment(key, ipMaxAttempts, IP_WINDOW_SECONDS);

    if (!result.success) {
      const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
      logger.warn(
        { subject: logIdentifier("ip", ip), attempts: ipMaxAttempts + 1 },
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
  const verifyMaxAttempts = getVerifyMaxAttempts();
  try {
    const result = await rateLimiter.increment(key, verifyMaxAttempts, VERIFY_WINDOW_SECONDS);

    if (!result.success) {
      logger.warn(
        { subject: logIdentifier("ip", ip), attempts: verifyMaxAttempts + 1 },
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
