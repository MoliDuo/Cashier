import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { OTP_LOCKOUT_MINUTES } from "@/config/tuning";

/** The failure columns shared by every emailed-code challenge table. */
interface ChallengeFailureColumns {
  attempts: PgColumn;
  lockedUntil: PgColumn;
  lastAttemptAt: PgColumn;
}

/**
 * The failure state a reissued code starts with. A fresh code does not refill
 * the guessing budget: failed attempts carry over until a whole lockout window
 * passes without one, and a lockout outlives any number of resends.
 */
export function carriedFailures(
  table: ChallengeFailureColumns,
  now: Date
): { attempts: SQL; lockedUntil: SQL } {
  const recentFailureCutoff = new Date(now.getTime() - OTP_LOCKOUT_MINUTES * 60 * 1000);
  return {
    attempts: sql`case
      when ${table.lockedUntil} > ${now} or ${table.lastAttemptAt} > ${recentFailureCutoff}
      then ${table.attempts}
      else 0
    end`,
    lockedUntil: sql`case when ${table.lockedUntil} > ${now} then ${table.lockedUntil} end`,
  };
}

/** One more failed attempt, locking the challenge when it reaches `maxAttempts`. */
export function recordedFailure(
  table: ChallengeFailureColumns,
  input: { maxAttempts: number; lockedUntil: Date; now: Date }
): { attempts: SQL; lastAttemptAt: Date; lockedUntil: SQL } {
  return {
    attempts: sql`${table.attempts} + 1`,
    lastAttemptAt: input.now,
    lockedUntil: sql`case
      when ${table.attempts} + 1 >= ${input.maxAttempts} then ${input.lockedUntil}
      else ${table.lockedUntil}
    end`,
  };
}
