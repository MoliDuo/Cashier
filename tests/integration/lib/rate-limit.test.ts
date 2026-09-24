import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireCooldown,
  incrementRateLimit,
  releaseCooldown,
  releaseRateLimitIncrement,
} from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

/** The count in the bucket's current fixed window; 0 when missing or expired. */
async function currentCount(bucketKey: string, windowSeconds: number): Promise<number> {
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  const result = await db.execute<{ curr_count: number }>(sql`
    SELECT count AS curr_count
    FROM rate_limit_buckets
    WHERE bucket_key = ${bucketKey}
      AND window_start = ${new Date(windowStart * 1000)}
  `);
  const row = result.rows?.[0];
  return row == null ? 0 : Number(row.curr_count);
}

describe("Postgres rate limiter", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T00:00:00.000Z"));
    await db.execute(sql`DELETE FROM rate_limit_buckets`);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns success when under limit", async () => {
    const result = await incrementRateLimit("test-under", 10, 60);
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it("returns failure when over limit", async () => {
    const bucketKey = "test-over-1";
    const limit = 5;

    for (let i = 0; i < limit; i++) {
      const result = await incrementRateLimit(bucketKey, limit, 60);
      expect(result.success).toBe(true);
    }

    const over = await incrementRateLimit(bucketKey, limit, 60);
    expect(over.success).toBe(false);
    expect(over.remaining).toBe(0);
  });

  it("resets count when window expires", async () => {
    const bucketKey = "test-window-reset";

    await incrementRateLimit(bucketKey, 2, 1);
    await incrementRateLimit(bucketKey, 2, 1);

    // Within same 1-second window — should be over limit
    const withinWindow = await incrementRateLimit(bucketKey, 2, 1);
    expect(withinWindow.success).toBe(false);

    // Wait for window to expire
    vi.advanceTimersByTime(1100);

    const afterReset = await incrementRateLimit(bucketKey, 2, 1);
    expect(afterReset.success).toBe(true);
    expect(afterReset.remaining).toBe(1);
  });

  it("tracks different bucket keys independently", async () => {
    const limit = 3;

    // Fill bucket-alpha to limit (3 increments)
    let result = await incrementRateLimit("bucket-alpha", limit, 60);
    expect(result.success).toBe(true);
    result = await incrementRateLimit("bucket-alpha", limit, 60);
    expect(result.success).toBe(true);
    result = await incrementRateLimit("bucket-alpha", limit, 60);
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(0);

    // One more should exceed the limit
    result = await incrementRateLimit("bucket-alpha", limit, 60);
    expect(result.success).toBe(false);

    // bucket-beta should still have all its capacity
    result = await incrementRateLimit("bucket-beta", limit, 60);
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(limit - 1);
  });

  it("handles sequential rapid increments accurately", async () => {
    const bucketKey = "test-rapid";
    const limit = 50;

    for (let i = 0; i < limit; i++) {
      const result = await incrementRateLimit(bucketKey, limit, 60);
      expect(result.success).toBe(true);
      expect(result.remaining).toBe(limit - (i + 1));
    }

    // One more should fail
    const over = await incrementRateLimit(bucketKey, limit, 60);
    expect(over.success).toBe(false);
    expect(over.remaining).toBe(0);
  });

  it("reports correct remaining count", async () => {
    const bucketKey = "test-remaining";
    const limit = 10;

    const r1 = await incrementRateLimit(bucketKey, limit, 60);
    expect(r1.remaining).toBe(9);

    const r2 = await incrementRateLimit(bucketKey, limit, 60);
    expect(r2.remaining).toBe(8);

    // Exhaust
    for (let i = 0; i < 8; i++) {
      await incrementRateLimit(bucketKey, limit, 60);
    }

    const r3 = await incrementRateLimit(bucketKey, limit, 60);
    expect(r3.remaining).toBe(0);
    expect(r3.success).toBe(false);
  });

  it("returns a resetTime in the future", async () => {
    const result = await incrementRateLimit("test-reset-time", 10, 60);
    expect(result.resetTime).toBeGreaterThan(Date.now());
  });

  it("counts the count of the current window", async () => {
    await incrementRateLimit("test-current-live", 10, 60);
    await incrementRateLimit("test-current-live", 10, 60);
    await incrementRateLimit("test-current-live", 10, 60);

    expect(await currentCount("test-current-live", 60)).toBe(3);
  });

  it("counts 0 for a missing bucket", async () => {
    expect(await currentCount("test-current-missing", 60)).toBe(0);
  });

  it("counts 0 once the window has expired", async () => {
    await incrementRateLimit("test-current-expired", 10, 1);
    expect(await currentCount("test-current-expired", 1)).toBe(1);

    vi.advanceTimersByTime(1100);
    expect(await currentCount("test-current-expired", 1)).toBe(0);
  });

  it("enforces shared limit across concurrent callers", async () => {
    const bucketKey = "test-concurrent";
    const limit = 10;

    // Fire limit+5 concurrent increments and count how many succeed
    const promises = Array.from({ length: limit + 5 }, () =>
      incrementRateLimit(bucketKey, limit, 60)
    );
    const results = await Promise.all(promises);

    const successes = results.filter((r) => r.success).length;
    expect(successes).toBe(limit);
    expect(results.filter((r) => !r.success).length).toBe(5);
  });

  it("releases only an increment from the matching fixed window", async () => {
    const reservation = await incrementRateLimit("test-release-increment", 10, 60);
    expect(await currentCount("test-release-increment", 60)).toBe(1);

    await releaseRateLimitIncrement("test-release-increment", 60, reservation.resetTime + 60_000);
    expect(await currentCount("test-release-increment", 60)).toBe(1);

    await releaseRateLimitIncrement("test-release-increment", 60, reservation.resetTime);
    expect(await currentCount("test-release-increment", 60)).toBe(0);
  });

  describe("cooldown methods", () => {
    it("grants exactly one lease to concurrent callers", async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, () => acquireCooldown("cd-concurrent", 60))
      );

      expect(results.filter((result) => result.acquired)).toHaveLength(1);
      expect(results.filter((result) => !result.acquired)).toHaveLength(7);
    });

    it("releases only the matching lease timestamp", async () => {
      const lease = await acquireCooldown("cd-release-cas", 60);
      expect(lease.acquired).toBe(true);

      await expect(
        releaseCooldown("cd-release-cas", new Date(lease.acquiredAt.getTime() + 1))
      ).resolves.toBe(false);
      await expect(acquireCooldown("cd-release-cas", 60)).resolves.toMatchObject({
        acquired: false,
      });
      await expect(releaseCooldown("cd-release-cas", lease.acquiredAt)).resolves.toBe(true);
      await expect(acquireCooldown("cd-release-cas", 60)).resolves.toMatchObject({
        acquired: true,
      });
    });

    it("acquireCooldown activates a cooldown and reports remaining time", async () => {
      const key = "cd-test-activate";

      await acquireCooldown(key, 60);

      const { retryAfter: remaining } = await acquireCooldown(key, 60);
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(60);
    });

    it("acquires a missing cooldown", async () => {
      expect(await acquireCooldown("cd-missing", 60)).toMatchObject({
        acquired: true,
        retryAfter: 0,
      });
    });

    it("reacquires an expired cooldown", async () => {
      const key = "cd-expired";

      await acquireCooldown(key, 1);
      await db.execute(
        sql`UPDATE rate_limit_buckets SET window_start = now() - interval '2 seconds' WHERE bucket_key = ${key}`
      );

      expect(await acquireCooldown(key, 1)).toMatchObject({
        acquired: true,
        retryAfter: 0,
      });
    });

    it("does not extend an active cooldown on another acquisition attempt", async () => {
      const key = "cd-refresh";

      const before = await acquireCooldown(key, 60);
      const after = await acquireCooldown(key, 60);
      expect(after).toMatchObject({ acquired: false, acquiredAt: before.acquiredAt });
    });
  });
});
