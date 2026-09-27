import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { acquireCooldown, consumeRateLimit, releaseCooldown } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { RateLimitUnavailableError } from "@/lib/errors";
import { SIGN_IN_RATE_LIMITS } from "@/config/tuning";

async function bucketKeys(): Promise<string[]> {
  const result = await db.execute<{ bucket_key: string }>(
    sql`SELECT bucket_key FROM rate_limit_buckets ORDER BY bucket_key`
  );
  return result.rows.map((row) => row.bucket_key);
}

describe("Postgres rate limiter", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-06T00:00:00.000Z"));
    await db.execute(sql`DELETE FROM rate_limit_buckets`);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("consumeRateLimit", () => {
    it("allows the named limit's quota in a window and then refuses until it resets", async () => {
      const { max, windowSeconds } = SIGN_IN_RATE_LIMITS.otpVerifyPerIp;
      for (let request = 0; request < max; request += 1) {
        await expect(consumeRateLimit("otpVerifyPerIp", "192.0.2.1")).resolves.toEqual({
          allowed: true,
        });
      }

      await expect(consumeRateLimit("otpVerifyPerIp", "192.0.2.1")).resolves.toEqual({
        allowed: false,
        retryAfterSeconds: windowSeconds,
      });

      vi.setSystemTime(new Date(Date.now() + windowSeconds * 1000));
      await expect(consumeRateLimit("otpVerifyPerIp", "192.0.2.1")).resolves.toEqual({
        allowed: true,
      });
    });

    it("counts each limit and each subject on its own", async () => {
      const { max } = SIGN_IN_RATE_LIMITS.otpVerifyPerIp;
      for (let request = 0; request <= max; request += 1) {
        await consumeRateLimit("otpVerifyPerIp", "192.0.2.1");
      }

      await expect(consumeRateLimit("otpVerifyPerIp", "192.0.2.2")).resolves.toEqual({
        allowed: true,
      });
      await expect(consumeRateLimit("otpSendPerIp", "192.0.2.1")).resolves.toEqual({
        allowed: true,
      });
    });

    it("shares one quota between concurrent callers", async () => {
      const { max } = SIGN_IN_RATE_LIMITS.passkeyStartPerIp;
      const results = await Promise.all(
        Array.from({ length: max + 5 }, () => consumeRateLimit("passkeyStartPerIp", "unknown"))
      );

      expect(results.filter((result) => result.allowed)).toHaveLength(max);
    });

    it("never stores the subject in a bucket key", async () => {
      await consumeRateLimit("otpSendPerIp", "203.0.113.9");
      await consumeRateLimit("enrollStartPerIp", "203.0.113.9");

      const keys = await bucketKeys();
      expect(keys).toHaveLength(2);
      for (const key of keys) {
        expect(key).toMatch(/^[A-Za-z]+:[a-f0-9]{64}$/);
        expect(key).not.toContain("203.0");
      }
    });

    it("fails closed when the counter cannot be written", async () => {
      vi.spyOn(db, "execute").mockRejectedValueOnce(new Error("DB error"));

      await expect(consumeRateLimit("otpSendPerIp", "192.0.2.1")).rejects.toBeInstanceOf(
        RateLimitUnavailableError
      );
    });
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
