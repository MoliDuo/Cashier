import { AppError, NotFoundError } from "@/lib/errors";
import { AUTH_ERROR_CODES } from "@/modules/auth/errors";
import { hashPassword, verifyPassword } from "@/modules/auth/services/password";
import { validatePassword } from "@/modules/auth/services/password-policy";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import type { AccountSecurityPort } from "../ports";
import type { RateLimiterPort } from "@/application/contracts";
import {
  AUTH_PASSWORD_EMAIL_MAX_ATTEMPTS,
  AUTH_PASSWORD_RATE_LIMIT_WINDOW_SECONDS,
} from "@/config/tuning";

const PASSWORD_CHANGE_PREFIX = "auth:password-change:user:";

async function releasePasswordChangeReservation(
  rateLimiter: RateLimiterPort,
  key: string,
  windowSeconds: number,
  resetTime: number,
  userId: string
) {
  try {
    await rateLimiter.releaseIncrement(key, windowSeconds, resetTime);
  } catch (error) {
    logger.error(
      { error, subject: logIdentifier("user", userId) },
      "Password change rate limit release failed"
    );
    throw new AppError("Password change unavailable", "password_rate_limited", 429);
  }
}

export async function changePassword(
  params: {
    userId: string;
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  },
  dependencies: { accounts: AccountSecurityPort; rateLimiter: RateLimiterPort }
): Promise<Date> {
  if (params.newPassword !== params.confirmPassword) {
    throw new AppError("Passwords do not match", AUTH_ERROR_CODES.PASSWORD_MISMATCH, 400);
  }
  validatePassword(params.newPassword);

  const key = `${PASSWORD_CHANGE_PREFIX}${params.userId}`;
  const limit = AUTH_PASSWORD_EMAIL_MAX_ATTEMPTS;
  const windowSeconds = AUTH_PASSWORD_RATE_LIMIT_WINDOW_SECONDS;
  let reservation: Awaited<ReturnType<RateLimiterPort["increment"]>>;
  try {
    reservation = await dependencies.rateLimiter.increment(key, limit, windowSeconds);
    if (!reservation.success) {
      throw new AppError("Too many password change attempts", "password_rate_limited", 429);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error(
      { error, subject: logIdentifier("user", params.userId) },
      "Password change rate limit reservation failed"
    );
    throw new AppError("Password change unavailable", "password_rate_limited", 429);
  }

  let currentPasswordHash: string | null | undefined;
  let currentPasswordValid: boolean;
  try {
    currentPasswordHash = await dependencies.accounts.getPasswordHash(params.userId);
    currentPasswordValid =
      currentPasswordHash != null &&
      (await verifyPassword(params.currentPassword, currentPasswordHash));
  } catch (error) {
    await releasePasswordChangeReservation(
      dependencies.rateLimiter,
      key,
      windowSeconds,
      reservation.resetTime,
      params.userId
    );
    throw error;
  }
  if (currentPasswordHash === undefined) {
    await releasePasswordChangeReservation(
      dependencies.rateLimiter,
      key,
      windowSeconds,
      reservation.resetTime,
      params.userId
    );
    throw new NotFoundError("User");
  }
  if (currentPasswordHash === null || !currentPasswordValid) {
    throw new AppError(
      "Current password is incorrect",
      AUTH_ERROR_CODES.CURRENT_PASSWORD_WRONG,
      400
    );
  }

  await releasePasswordChangeReservation(
    dependencies.rateLimiter,
    key,
    windowSeconds,
    reservation.resetTime,
    params.userId
  );

  const passwordHash = await hashPassword(params.newPassword);
  const passwordUpdatedAt = new Date();
  const changed = await dependencies.accounts.changePassword({
    userId: params.userId,
    expectedPasswordHash: currentPasswordHash,
    passwordHash,
    passwordUpdatedAt,
  });
  if (!changed) throw new AppError("Password changed concurrently", "CONFLICT", 409);
  return passwordUpdatedAt;
}
