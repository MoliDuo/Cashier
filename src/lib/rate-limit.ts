/**
 * Postgres-backed fixed-window rate limiter.
 *
 * Provides cross-instance rate limiting using atomic INSERT ... ON CONFLICT
 * increment pattern in a dedicated rate_limit_buckets table.
 */

import "server-only";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  /** Unix timestamp in milliseconds when the current fixed window resets. */
  resetTime: number;
}

/**
 * Atomically increment the counter for a bucket key.
 *
 * Creates a new bucket row if none exists, otherwise increments the count
 * if still within the same time window. Resets the count and window if the
 * window has expired.
 *
 * @param bucketKey - Unique key identifying the rate-limit bucket
 * @param limit     - Maximum number of requests allowed per window
 * @param windowSeconds - Time window in seconds
 */
export async function incrementRateLimit(
  bucketKey: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  const windowStartDate = new Date(windowStart * 1000);

  const result = await db.execute<{
    curr_count: number;
    window_start: Date;
  }>(sql`
    INSERT INTO rate_limit_buckets (bucket_key, count, window_start, created_at)
    VALUES (${bucketKey}, 1, ${windowStartDate}, NOW())
    ON CONFLICT (bucket_key) DO UPDATE SET
      count = CASE
        WHEN rate_limit_buckets.window_start = ${windowStartDate}
          THEN rate_limit_buckets.count + 1
        ELSE 1
      END,
      window_start = CASE
        WHEN rate_limit_buckets.window_start = ${windowStartDate}
          THEN rate_limit_buckets.window_start
        ELSE ${windowStartDate}
      END
    RETURNING count AS curr_count, window_start
  `);

  const row = result.rows?.[0];
  if (row == null) {
    // Fallback: should not happen with RETURNING
    return {
      success: true,
      remaining: limit - 1,
      resetTime: (windowStart + windowSeconds) * 1000,
    };
  }

  const currCount = Number(row.curr_count);
  const resetTime = (windowStart + windowSeconds) * 1000;

  return {
    success: currCount <= limit,
    remaining: Math.max(0, limit - currCount),
    resetTime,
  };
}

export async function releaseRateLimitIncrement(
  bucketKey: string,
  windowSeconds: number,
  resetTime: number
): Promise<void> {
  const windowStart = new Date(resetTime - windowSeconds * 1000);
  await db.execute(sql`
    UPDATE rate_limit_buckets
    SET count = GREATEST(0, count - 1)
    WHERE bucket_key = ${bucketKey}
      AND window_start = ${windowStart}
      AND count > 0
  `);
}

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

export async function releaseCooldown(bucketKey: string, acquiredAt: Date): Promise<boolean> {
  const result = await db.execute(sql`
    DELETE FROM rate_limit_buckets
    WHERE bucket_key = ${bucketKey}
      AND window_start = ${acquiredAt}
    RETURNING bucket_key
  `);
  return (result.rows?.length ?? 0) === 1;
}
