import { getLockoutExpiration, getMaxAttempts, verifyOTP } from "./otp";

interface VerificationChallengeRecord {
  tokenHash: string;
  expiresAt: Date;
  attempts: number;
  lockedUntil: Date | null;
}

type ChallengeCheck =
  | { ok: true }
  | { ok: false; reason: "locked"; lockedUntil: Date }
  | { ok: false; reason: "expired" | "invalid" };

class VerificationChallengeService {
  check(record: VerificationChallengeRecord, otp: string, now = new Date()): ChallengeCheck {
    if (record.lockedUntil != null && record.lockedUntil > now) {
      return { ok: false, reason: "locked", lockedUntil: record.lockedUntil };
    }
    if (record.expiresAt <= now) return { ok: false, reason: "expired" };
    return verifyOTP(otp, record.tokenHash) ? { ok: true } : { ok: false, reason: "invalid" };
  }

  nextFailure(attempts: number) {
    const nextAttempts = attempts + 1;
    const maxAttempts = getMaxAttempts();
    const lockedUntil = nextAttempts >= maxAttempts ? getLockoutExpiration() : null;
    return {
      attempts: nextAttempts,
      lockedUntil,
      attemptsRemaining: Math.max(0, maxAttempts - nextAttempts),
    };
  }
}

export const verificationChallenges = new VerificationChallengeService();
