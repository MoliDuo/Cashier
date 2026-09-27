import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  acquireResendCooldown,
  releaseResendCooldown,
} from "@/modules/auth/server/otp-resend-cooldown";
import * as rateLimit from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { RateLimitUnavailableError } from "@/lib/errors";
import { sql } from "drizzle-orm";

describe("OTP resend cooldown", () => {
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM rate_limit_buckets`);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never stores the address in the bucket key", async () => {
    await acquireResendCooldown("Person@Example.com");

    const rows = await db.execute<{ bucket_key: string }>(
      sql`SELECT bucket_key FROM rate_limit_buckets`
    );
    expect(rows.rows).toEqual([{ bucket_key: expect.stringMatching(/^otp:resend:[a-f0-9]{64}$/) }]);
  });

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
