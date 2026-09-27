import "server-only";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { RateLimitUnavailableError } from "@/lib/errors";
import { getResendCooldown } from "../domain/otp";
import { acquireCooldown, rateLimitKey, releaseCooldown } from "@/lib/rate-limit";

/**
 * The resend cooldown is per address, known or not, so an unknown address is
 * refused exactly like a real one and the answer reveals nothing.
 */
function cooldownKey(email: string): string {
  return rateLimitKey("otp:resend", email.trim().toLowerCase());
}

export async function acquireResendCooldown(email: string): Promise<{
  acquired: boolean;
  acquiredAt: Date;
  retryAfter: number;
}> {
  try {
    return await acquireCooldown(cooldownKey(email), getResendCooldown());
  } catch (error) {
    logger.error(
      { error, subject: logIdentifier("email", email), purpose: "resend_cooldown" },
      "OTP resend cooldown check failed"
    );
    throw new RateLimitUnavailableError();
  }
}

export async function releaseResendCooldown(email: string, acquiredAt: Date): Promise<boolean> {
  return releaseCooldown(cooldownKey(email), acquiredAt);
}
