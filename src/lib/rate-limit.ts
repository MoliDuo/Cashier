/**
 * Postgres-backed rate limits for the requests made before signing in.
 *
 * Counters live in `rate_limit_buckets`, one row per bucket, updated with a
 * single atomic INSERT ... ON CONFLICT so every instance shares them. Nothing
 * a signed-in session does is limited.
 */

import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { RateLimitUnavailableError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { keyedDigest } from "@/lib/security/keys";
import { SIGN_IN_RATE_LIMITS } from "@/config/tuning";

export type RateLimitName = keyof typeof SIGN_IN_RATE_LIMITS;

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * The one way to name a bucket: the purpose stays readable, and the subject —
 * an email or an IP — is only ever stored as an HMAC.
 */
export function rateLimitKey(purpose: string, ...subject: string[]): string {
  return `${purpose}:${keyedDigest("rate-limit", [purpose, ...subject].join("\0"))}`;
}

/**
 * Counts one request against the named limit for `subject` in the current
 * fixed window. Fails closed: when the counter cannot be read the request is
 * refused with `RateLimitUnavailableError` rather than let through.
 */
export async function consumeRateLimit(
  name: RateLimitName,
  subject: string
): Promise<RateLimitDecision> {
  const { max, windowSeconds } = SIGN_IN_RATE_LIMITS[name];
  const windowStartSeconds = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  const windowStart = new Date(windowStartSeconds * 1000);

  let count: number;
  try {
    const result = await db.execute<{ count: number }>(sql`
      INSERT INTO rate_limit_buckets (bucket_key, count, window_start, created_at)
      VALUES (${rateLimitKey(name, subject)}, 1, ${windowStart}, NOW())
      ON CONFLICT (bucket_key) DO UPDATE SET
        count = CASE
          WHEN rate_limit_buckets.window_start = EXCLUDED.window_start
            THEN rate_limit_buckets.count + 1
          ELSE 1
        END,
        window_start = EXCLUDED.window_start
      RETURNING count
    `);
    count = Number(result.rows[0]?.count ?? 1);
  } catch (error) {
    logger.error({ error, rateLimit: name }, "Rate limit check failed");
    throw new RateLimitUnavailableError();
  }

  if (count <= max) return { allowed: true };
  logger.warn({ rateLimit: name, max, windowSeconds }, "Rate limit exceeded");
  const retryAfterSeconds = windowStartSeconds + windowSeconds - Math.floor(Date.now() / 1000);
  return { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
}

/**
 * Takes a cooldown lease on `bucketKey` unless one taken less than `seconds`
 * ago still holds. Exactly one of concurrent callers acquires it.
 */
export async function acquireCooldown(
  bucketKey: string,
  seconds: number
): Promise<{ acquired: boolean; acquiredAt: Date; retryAfter: number }> {
  const result = await db.execute<{ window_start: Date }>(sql`
    INSERT INTO rate_limit_buckets (bucket_key, count, window_start, created_at)
    VALUES (${bucketKey}, 1, date_trunc('milliseconds', NOW()), NOW())
    ON CONFLICT (bucket_key) DO UPDATE SET
      count = 1,
      window_start = date_trunc('milliseconds', NOW())
    WHERE rate_limit_buckets.window_start <= NOW() - ${seconds} * INTERVAL '1 second'
    RETURNING window_start
  `);
  const acquiredAt = result.rows?.[0]?.window_start;
  if (acquiredAt != null) {
    return { acquired: true, acquiredAt: new Date(acquiredAt), retryAfter: 0 };
  }

  const existing = await db.execute<{ window_start: Date; retry_after: number }>(sql`
    SELECT window_start,
      GREATEST(0, CEIL(EXTRACT(EPOCH FROM (
        window_start + ${seconds} * INTERVAL '1 second' - NOW()
      ))))::integer AS retry_after
    FROM rate_limit_buckets
    WHERE bucket_key = ${bucketKey}
  `);
  const row = existing.rows?.[0];
  return {
    acquired: false,
    acquiredAt: row?.window_start == null ? new Date() : new Date(row.window_start),
    retryAfter: row?.retry_after == null ? seconds : Number(row.retry_after),
  };
}

/** Gives back the lease taken at `acquiredAt`, and only that one. */
export async function releaseCooldown(bucketKey: string, acquiredAt: Date): Promise<boolean> {
  const result = await db.execute(sql`
    DELETE FROM rate_limit_buckets
    WHERE bucket_key = ${bucketKey}
      AND window_start = ${acquiredAt}
    RETURNING bucket_key
  `);
  return (result.rows?.length ?? 0) === 1;
}
