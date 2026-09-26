import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  checkSendRateLimit,
  checkSendRateLimitByIP,
  acquireResendCooldown,
  releaseResendCooldown,
  checkVerifyRateLimit,
} from "@/modules/auth/server/otp-rate-limit";
import * as rateLimit from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { RateLimitUnavailableError } from "@/lib/errors";
import { sql } from "drizzle-orm";

describe("OTP Rate Limiting", () => {
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM rate_limit_buckets`);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("checkSendRateLimit (per email)", () => {
    it("should allow first 10 sends within 15 minutes", async () => {
      const email = "test@example.com";

      for (let i = 0; i < 10; i++) {
        const result = await checkSendRateLimit(email);
        expect(result.allowed).toBe(true);
        expect(result.remainingAttempts).toBe(10 - i - 1);
      }
    });

    it("should block 11th send and return retryAfter", async () => {
      const email = "test@example.com";

      // Use up 10 attempts
      for (let i = 0; i < 10; i++) {
        await checkSendRateLimit(email);
      }

      // 11th attempt should be blocked
      const result = await checkSendRateLimit(email);
      expect(result.allowed).toBe(false);
      expect(result.remainingAttempts).toBe(0);
      expect(result.retryAfter).toBeGreaterThan(0);
      expect(result.retryAfter).toBeLessThanOrEqual(15 * 60); // Max 15 minutes
    });

    it("should be case-insensitive for email", async () => {
      // Use up 9 attempts with different cases
      for (let i = 0; i < 9; i++) {
        await checkSendRateLimit(i % 2 === 0 ? "Test@Example.COM" : "TEST@EXAMPLE.COM");
      }

      // 10th attempt with lowercase should still work
      const result1 = await checkSendRateLimit("test@example.com");
      expect(result1.allowed).toBe(true);

      // 11th attempt should be blocked
      const result2 = await checkSendRateLimit("test@example.com");
      expect(result2.allowed).toBe(false);
      expect(result2.remainingAttempts).toBe(0);
    });

    it("should fail closed on error", async () => {
      vi.spyOn(rateLimit, "incrementRateLimit").mockRejectedValue(new Error("DB error"));

      await expect(checkSendRateLimit("test@example.com")).rejects.toBeInstanceOf(
        RateLimitUnavailableError
      );
    });
  });

  describe("checkSendRateLimitByIP", () => {
    it("never stores the address or the IP in a bucket key", async () => {
      await checkSendRateLimit("Person@Example.com");
      await checkSendRateLimitByIP("203.0.113.9");
      await acquireResendCooldown("person@example.com");
      await checkVerifyRateLimit("203.0.113.9");

      const rows = await db.execute<{ bucket_key: string }>(
        sql`SELECT bucket_key FROM rate_limit_buckets`
      );
      expect(rows.rows).toHaveLength(4);
      for (const row of rows.rows) {
        expect(row.bucket_key).toMatch(/^otp:[a-z:]+:[a-f0-9]{64}$/);
        expect(row.bucket_key).not.toMatch(/example|203\.0/i);
      }
    });

    it("uses a hashed shared IP bucket when the client IP is unknown", async () => {
      const increment = vi.spyOn(rateLimit, "incrementRateLimit");

      const result = await checkSendRateLimitByIP("unknown");

      expect(result.allowed).toBe(true);
      expect(increment).toHaveBeenCalledWith(
        expect.stringMatching(/^otp:send:ip:[a-f0-9]+$/),
        10,
        3600
      );
    });
    it("should allow first 10 sends within 1 hour", async () => {
      const ip = "192.168.1.1";

      for (let i = 0; i < 10; i++) {
        const result = await checkSendRateLimitByIP(ip);
        expect(result.allowed).toBe(true);
        expect(result.remainingAttempts).toBe(10 - i - 1);
      }
    });

    it("should block 11th send and return retryAfter", async () => {
      const ip = "192.168.1.1";

      // Use up 10 attempts
      for (let i = 0; i < 10; i++) {
        await checkSendRateLimitByIP(ip);
      }

      // 11th attempt should be blocked
      const result = await checkSendRateLimitByIP(ip);
      expect(result.allowed).toBe(false);
      expect(result.remainingAttempts).toBe(0);
      expect(result.retryAfter).toBeGreaterThan(0);
      expect(result.retryAfter).toBeLessThanOrEqual(60 * 60); // Max 1 hour
    });

    it("should fail closed on error", async () => {
      vi.spyOn(rateLimit, "incrementRateLimit").mockRejectedValue(new Error("DB error"));

      await expect(checkSendRateLimitByIP("192.168.1.1")).rejects.toBeInstanceOf(
        RateLimitUnavailableError
      );
    });
  });

  describe("atomic resend cooldown", () => {
    it("allows only one concurrent acquisition for a normalized email", async () => {
      const results = await Promise.all([
        acquireResendCooldown("Test@Example.COM"),
        acquireResendCooldown("test@example.com"),
      ]);

      expect(results.filter((result) => result.acquired)).toHaveLength(1);
      expect(results.filter((result) => !result.acquired)).toHaveLength(1);
      expect(results.find((result) => !result.acquired)?.retryAfter).toBeGreaterThan(0);
    });

    it("can release the exact acquisition and acquire again", async () => {
      const email = "test@example.com";
      const first = await acquireResendCooldown(email);

      expect(first.acquired).toBe(true);
      await expect(releaseResendCooldown(email, first.acquiredAt)).resolves.toBe(true);
      await expect(acquireResendCooldown(email)).resolves.toMatchObject({ acquired: true });
    });

    it("fails closed when acquisition storage is unavailable", async () => {
      vi.spyOn(rateLimit, "acquireCooldown").mockRejectedValue(new Error("DB error"));

      await expect(acquireResendCooldown("test@example.com")).rejects.toBeInstanceOf(
        RateLimitUnavailableError
      );
    });
  });

  describe("checkVerifyRateLimit (brute force protection)", () => {
    it("uses a hashed shared verification bucket for an unknown IP", async () => {
      const increment = vi.spyOn(rateLimit, "incrementRateLimit");

      await expect(checkVerifyRateLimit("unknown")).resolves.toBe(true);
      expect(increment).toHaveBeenCalledWith(
        expect.stringMatching(/^otp:verify:[a-f0-9]+$/),
        5,
        60
      );
    });
    it("should allow first 5 verifications per minute", async () => {
      const ip = "192.168.1.1";

      for (let i = 0; i < 5; i++) {
        const result = await checkVerifyRateLimit(ip);
        expect(result).toBe(true);
      }
    });

    it("should block 6th verification", async () => {
      const ip = "192.168.1.1";

      // Use up 5 attempts
      for (let i = 0; i < 5; i++) {
        await checkVerifyRateLimit(ip);
      }

      // 6th attempt should be blocked
      const result = await checkVerifyRateLimit(ip);
      expect(result).toBe(false);
    });

    it("should fail closed on verification limit errors", async () => {
      vi.spyOn(rateLimit, "incrementRateLimit").mockRejectedValue(new Error("DB error"));

      await expect(checkVerifyRateLimit("192.168.1.1")).rejects.toBeInstanceOf(
        RateLimitUnavailableError
      );
    });
  });

  describe("Rate limit isolation", () => {
    it("should isolate rate limits between different emails", async () => {
      const email1 = "user1@example.com";
      const email2 = "user2@example.com";

      // Use up email1's attempts
      for (let i = 0; i < 10; i++) {
        await checkSendRateLimit(email1);
      }

      // email2 should still have full attempts
      const result = await checkSendRateLimit(email2);
      expect(result.allowed).toBe(true);
      expect(result.remainingAttempts).toBe(9);
    });

    it("should isolate rate limits between different IPs", async () => {
      const ip1 = "192.168.1.1";
      const ip2 = "192.168.1.2";

      // Use up ip1's attempts
      for (let i = 0; i < 10; i++) {
        await checkSendRateLimitByIP(ip1);
      }

      // ip2 should still have full attempts
      const result = await checkSendRateLimitByIP(ip2);
      expect(result.allowed).toBe(true);
      expect(result.remainingAttempts).toBe(9);
    });
  });
});
