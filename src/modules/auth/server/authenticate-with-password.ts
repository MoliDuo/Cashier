import "server-only";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { getClientIPFromHeaders, type HeadersLike } from "@/lib/utils/ip";
import type { AuthenticatedPrincipal } from "@/modules/auth/contracts";
import { AuthSignInError, AUTH_ERROR_CODES } from "@/modules/auth/errors";
import { normalizeEmail } from "@/lib/utils/email";
import { verifyPassword } from "@/modules/auth/domain/password";
import { incrementRateLimit, rateLimitKey, releaseRateLimitIncrement } from "@/lib/rate-limit";
import { findUserByEmail, type UserAccount } from "./users";
import {
  AUTH_PASSWORD_EMAIL_MAX_ATTEMPTS,
  AUTH_PASSWORD_IP_MAX_ATTEMPTS,
  AUTH_PASSWORD_RATE_LIMIT_WINDOW_SECONDS,
} from "@/config/tuning";

const DUMMY_PASSWORD_HASH = "$2b$12$E.Rov9WCSx5iCVVlYJTgLOGGjHYsuet/YKxmEZ03AXS8OY.ivReI2";

type PasswordRateLimitReservation = { key: string; resetTime: number };

async function reservePasswordRateLimits(
  email: string,
  ip: string
): Promise<PasswordRateLimitReservation[]> {
  const reservations: PasswordRateLimitReservation[] = [];
  const windowSeconds = AUTH_PASSWORD_RATE_LIMIT_WINDOW_SECONDS;
  try {
    const emailKey = rateLimitKey("auth:password:email", email);
    const emailResult = await incrementRateLimit(
      emailKey,
      AUTH_PASSWORD_EMAIL_MAX_ATTEMPTS,
      windowSeconds
    );
    if (!emailResult.success) {
      throw new AuthSignInError(AUTH_ERROR_CODES.PASSWORD_RATE_LIMITED);
    }
    reservations.push({ key: emailKey, resetTime: emailResult.resetTime });

    const ipKey = rateLimitKey("auth:password:ip", ip);
    const ipResult = await incrementRateLimit(ipKey, AUTH_PASSWORD_IP_MAX_ATTEMPTS, windowSeconds);
    if (!ipResult.success) {
      await Promise.all(
        reservations.map((reservation) =>
          releaseRateLimitIncrement(reservation.key, windowSeconds, reservation.resetTime)
        )
      );
      throw new AuthSignInError(AUTH_ERROR_CODES.PASSWORD_RATE_LIMITED);
    }
    reservations.push({ key: ipKey, resetTime: ipResult.resetTime });
    return reservations;
  } catch (error) {
    if (error instanceof AuthSignInError) throw error;

    await Promise.allSettled(
      reservations.map((reservation) =>
        releaseRateLimitIncrement(reservation.key, windowSeconds, reservation.resetTime)
      )
    );

    logger.error(
      {
        error,
        emailSubject: logIdentifier("email", email),
        ipSubject: logIdentifier("ip", ip),
      },
      "Password rate limit reservation failed"
    );
    throw new AuthSignInError(AUTH_ERROR_CODES.PASSWORD_RATE_LIMIT_UNAVAILABLE);
  }
}

async function releasePasswordRateLimits(
  reservations: PasswordRateLimitReservation[],
  email: string,
  ip: string
) {
  try {
    const windowSeconds = AUTH_PASSWORD_RATE_LIMIT_WINDOW_SECONDS;
    await Promise.all(
      reservations.map((reservation) =>
        releaseRateLimitIncrement(reservation.key, windowSeconds, reservation.resetTime)
      )
    );
  } catch (error) {
    logger.error(
      { error, emailSubject: logIdentifier("email", email), ipSubject: logIdentifier("ip", ip) },
      "Password rate limit release failed"
    );
    throw new AuthSignInError(AUTH_ERROR_CODES.PASSWORD_RATE_LIMIT_UNAVAILABLE);
  }
}

export async function authenticateWithPassword(params: {
  email: string;
  password: string;
  requestHeaders: HeadersLike;
}): Promise<AuthenticatedPrincipal> {
  const email = normalizeEmail(params.email);
  const ip = getClientIPFromHeaders(params.requestHeaders);
  const reservations = await reservePasswordRateLimits(email, ip);

  let user: UserAccount | null;
  let valid: boolean;
  try {
    user = email === "" ? null : await findUserByEmail(email);
    valid = await verifyPassword(params.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  } catch (error) {
    await releasePasswordRateLimits(reservations, email, ip);
    throw error;
  }

  if (user == null || !valid) {
    logger.warn({ subject: logIdentifier("email", email) }, "Password sign-in failed");
    throw new AuthSignInError(AUTH_ERROR_CODES.INVALID_CREDENTIALS);
  }

  await releasePasswordRateLimits(reservations, email, ip);

  return {
    id: user.id,
    email: user.email,
  };
}
