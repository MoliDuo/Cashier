import "server-only";
import { logger } from "@/lib/logger";
import { getLockoutExpiration, getMaxAttempts } from "../services/otp";
import { verificationChallenges } from "../services/verification-challenge";
import { consumeOtpToken, recordOtpFailure, type OtpToken } from "./otp-tokens";

export interface VerificationResult {
  success: boolean;
  reason?: "not_found" | "expired" | "locked" | "invalid" | "max_attempts";
  attemptsRemaining?: number;
  lockedUntil?: Date;
}

export async function verifyOTPWithPolicy(
  email: string,
  otp: string,
  record: OtpToken
): Promise<VerificationResult> {
  const check = verificationChallenges.check(record, otp);
  if (!check.ok && check.reason === "locked") {
    return { success: false, reason: "locked", lockedUntil: check.lockedUntil };
  }
  if (!check.ok && check.reason === "expired") return { success: false, reason: "expired" };
  if (!check.ok) {
    const maxAttempts = getMaxAttempts();
    const failure = await recordOtpFailure({
      email: email.toLowerCase(),
      tokenHash: record.tokenHash,
      maxAttempts,
      lockedUntil: getLockoutExpiration(),
    });
    if (failure == null) return { success: false, reason: "not_found" };
    if (failure.attempts >= maxAttempts) {
      return {
        success: false,
        reason: "max_attempts",
        attemptsRemaining: 0,
        ...(failure.lockedUntil == null ? {} : { lockedUntil: failure.lockedUntil }),
      };
    }
    return {
      success: false,
      reason: "invalid",
      attemptsRemaining: maxAttempts - failure.attempts,
    };
  }
  const consumed = await consumeOtpToken({
    email: email.toLowerCase(),
    tokenHash: record.tokenHash,
    now: new Date(),
    maxAttempts: getMaxAttempts(),
  });
  if (!consumed) return { success: false, reason: "not_found" };
  logger.info("OTP verified and consumed successfully");
  return { success: true };
}
