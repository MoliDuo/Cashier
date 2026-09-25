import { describe, it, expect, beforeEach } from "vitest";
import { getTestDb } from "tests/setup";
import {
  createOtpToken as createOTPToken,
  discardOtpToken,
  findOtpToken as findOTPRecord,
} from "@/modules/auth/server/otp-tokens";
import { verifyOTPWithPolicy } from "@/modules/auth/server/otp-verification";
import { generateOTP, verifyOTP } from "@/modules/auth/domain/otp";
import { otpTokens } from "@/persistence/schema/auth";
import { eq } from "drizzle-orm";
import { runBoundedMaintenance } from "@/server/maintenance/run";

const deleteOTPToken = async (email: string) => {
  const token = await findOTPRecord(email);
  if (token != null) await discardOtpToken(email, token.tokenHash);
};
const cleanupExpiredOTPTokens = async () => {
  const db = getTestDb();
  const before = await db.select().from(otpTokens);
  await runBoundedMaintenance();
  return before.length - (await db.select().from(otpTokens)).length;
};

// Helper function for tests - combines data access and business logic
async function verifyOTPToken(email: string, otp: string) {
  const record = await findOTPRecord(email);
  if (!record) {
    return { success: false, reason: "not_found" as const };
  }
  return verifyOTPWithPolicy(email, otp, record);
}

function requireDefined<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

describe("OTP Repository", () => {
  const testEmail = "otp-test@example.com";
  let db: ReturnType<typeof getTestDb>;

  beforeEach(async () => {
    db = getTestDb();
    // Clean OTP tokens before each test
    await db.delete(otpTokens);
  });

  describe("createOTPToken", () => {
    it("should create a new OTP token", async () => {
      const otp = generateOTP();
      const result = await createOTPToken(testEmail, otp, "127.0.0.1");

      expect(result.expiresAt).toBeInstanceOf(Date);

      // Verify token exists in database
      const tokens = await db.select().from(otpTokens);
      expect(tokens).toHaveLength(1);
      const token = requireDefined(tokens[0], "Expected created OTP token");
      expect(token.email).toBe(testEmail.toLowerCase());
      expect(token.ipAddress).toBe("127.0.0.1");
    });

    it("should delete old OTP when creating new one", async () => {
      const otp1 = generateOTP();
      const otp2 = generateOTP();

      await createOTPToken(testEmail, otp1, "127.0.0.1");
      await createOTPToken(testEmail, otp2, "127.0.0.1");

      // Should only have one token
      const tokens = await db.select().from(otpTokens);
      expect(tokens).toHaveLength(1);

      // Should be the second OTP
      const isValid = await verifyOTPToken(testEmail, otp2);
      expect(isValid.success).toBe(true);
    });

    it("should normalize email to lowercase", async () => {
      const otp = generateOTP();
      await createOTPToken("Test@Example.COM", otp, "127.0.0.1");

      const tokens = await db.select().from(otpTokens);
      const token = requireDefined(tokens[0], "Expected normalized OTP token");
      expect(token.email).toBe("test@example.com");
    });

    it("should store hashed OTP, not plain text", async () => {
      const otp = generateOTP();
      await createOTPToken(testEmail, otp, "127.0.0.1");

      const tokens = await db.select().from(otpTokens);
      const token = requireDefined(tokens[0], "Expected stored OTP token");
      expect(token.tokenHash).not.toBe(otp);
      // Verify the stored hash can be verified with the OTP (supports both new and legacy formats)
      expect(verifyOTP(otp, token.tokenHash)).toBe(true);
    });
  });

  describe("verifyOTPToken", () => {
    it("should verify correct OTP", async () => {
      const otp = generateOTP();
      await createOTPToken(testEmail, otp, "127.0.0.1");

      const result = await verifyOTPToken(testEmail, otp);

      expect(result.success).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should reject incorrect OTP", async () => {
      const otp = generateOTP();
      await createOTPToken(testEmail, otp, "127.0.0.1");

      const result = await verifyOTPToken(testEmail, "000000");

      expect(result.success).toBe(false);
      expect(result.reason).toBe("invalid");
      expect(result.attemptsRemaining).toBe(4); // 5 - 1 = 4
    });

    it("should increment attempts on failed verification", async () => {
      const otp = generateOTP();
      await createOTPToken(testEmail, otp, "127.0.0.1");

      await verifyOTPToken(testEmail, "000000");
      await verifyOTPToken(testEmail, "111111");
      const result = await verifyOTPToken(testEmail, "222222");

      expect(result.attemptsRemaining).toBe(2); // 5 - 3 = 2
    });

    it("should lock account after max attempts", async () => {
      const otp = generateOTP();
      await createOTPToken(testEmail, otp, "127.0.0.1");

      // Attempt 5 times with wrong OTP
      for (let i = 0; i < 4; i++) {
        await verifyOTPToken(testEmail, "000000");
      }

      const result = await verifyOTPToken(testEmail, "111111");

      expect(result.success).toBe(false);
      expect(result.reason).toBe("max_attempts");
      expect(result.attemptsRemaining).toBe(0);
      expect(result.lockedUntil).toBeInstanceOf(Date);
    });

    it("should reject verification when account is locked", async () => {
      const otp = generateOTP();
      await createOTPToken(testEmail, otp, "127.0.0.1");

      // Lock the account
      for (let i = 0; i < 5; i++) {
        await verifyOTPToken(testEmail, "000000");
      }

      // Try with correct OTP
      const result = await verifyOTPToken(testEmail, otp);

      expect(result.success).toBe(false);
      expect(result.reason).toBe("locked");
    });

    it("should reject expired OTP", async () => {
      const otp = generateOTP();
      await createOTPToken(testEmail, otp, "127.0.0.1");

      // Manually set expiration to past
      // Manually set expiration to past
      await db
        .update(otpTokens)
        .set({ expires: new Date(Date.now() - 1000 * 60 * 60) })
        .where(eq(otpTokens.email, testEmail.toLowerCase()));

      const result = await verifyOTPToken(testEmail, otp);

      expect(result.success).toBe(false);
      expect(result.reason).toBe("expired");
    });

    it("should return not_found when no OTP exists", async () => {
      const result = await verifyOTPToken("nonexistent@example.com", "123456");

      expect(result.success).toBe(false);
      expect(result.reason).toBe("not_found");
    });

    it("spends the OTP the moment it verifies", async () => {
      const otp = generateOTP();
      await createOTPToken(testEmail, otp, "127.0.0.1");

      const result = await verifyOTPToken(testEmail, otp);

      expect(result.success).toBe(true);
      expect(await db.select().from(otpTokens)).toHaveLength(0);
    });

    it("should allow only one concurrent successful consumption", async () => {
      const otp = generateOTP();
      await createOTPToken(testEmail, otp, "127.0.0.1");

      const results = await Promise.all([
        verifyOTPToken(testEmail, otp),
        verifyOTPToken(testEmail, otp),
      ]);

      expect(results.filter((result) => result.success)).toHaveLength(1);
      expect(await db.select().from(otpTokens)).toHaveLength(0);
    });

    it("refuses an OTP that has already been spent", async () => {
      const otp = generateOTP();
      await createOTPToken(testEmail, otp, "127.0.0.1");

      expect((await verifyOTPToken(testEmail, otp)).success).toBe(true);
      expect((await verifyOTPToken(testEmail, otp)).reason).toBe("not_found");
    });

    it("counts concurrent failed attempts without lost updates", async () => {
      const otp = generateOTP();
      await createOTPToken(testEmail, otp, "127.0.0.1");

      await Promise.all([
        verifyOTPToken(testEmail, "000000"),
        verifyOTPToken(testEmail, "111111"),
        verifyOTPToken(testEmail, "222222"),
      ]);

      const token = requireDefined(
        (await db.select().from(otpTokens))[0],
        "Expected failed OTP token"
      );
      expect(token.attempts).toBe(3);
    });
  });

  describe("verification lockout policy", () => {
    it("should return false when no OTP exists", async () => {
      const result = await verifyOTPToken("nonexistent@example.com", "123456");
      expect(result).toMatchObject({ success: false, reason: "not_found" });
    });

    it("should return false when account is not locked", async () => {
      const otp = generateOTP();
      await createOTPToken(testEmail, otp, "127.0.0.1");

      const result = await verifyOTPToken(testEmail, otp);
      expect(result.success).toBe(true);
    });

    it("should return true when account is locked", async () => {
      const otp = generateOTP();
      await createOTPToken(testEmail, otp, "127.0.0.1");

      // Lock the account
      for (let i = 0; i < 5; i++) {
        await verifyOTPToken(testEmail, "000000");
      }

      const result = await verifyOTPToken(testEmail, otp);
      expect(result).toMatchObject({ success: false, reason: "locked" });
      expect(result.lockedUntil).toBeInstanceOf(Date);
    });

    it("should return false when lockout has expired", async () => {
      const otp = generateOTP();
      await createOTPToken(testEmail, otp, "127.0.0.1");

      // Set lockout to past
      // Set lockout to past
      await db
        .update(otpTokens)
        .set({ lockedUntil: new Date(Date.now() - 1000 * 60 * 60) })
        .where(eq(otpTokens.email, testEmail.toLowerCase()));

      const result = await verifyOTPToken(testEmail, otp);
      expect(result.success).toBe(true);
    });
  });

  describe("issuing a new code", () => {
    const sixteenMinutesAgo = () => new Date(Date.now() - 16 * 60 * 1000);

    it("keeps an active lockout", async () => {
      await createOTPToken(testEmail, generateOTP());
      for (let i = 0; i < 5; i++) {
        await verifyOTPToken(testEmail, "000000");
      }

      const otp = generateOTP();
      await createOTPToken(testEmail, otp);

      const result = await verifyOTPToken(testEmail, otp);
      expect(result).toMatchObject({ success: false, reason: "locked" });
    });

    it("carries recent failed attempts over to the new code", async () => {
      await createOTPToken(testEmail, generateOTP());
      for (let i = 0; i < 3; i++) {
        await verifyOTPToken(testEmail, "000000");
      }

      await createOTPToken(testEmail, generateOTP());

      const result = await verifyOTPToken(testEmail, "000000");
      expect(result.attemptsRemaining).toBe(1);
    });

    it("starts a fresh budget once a lockout window passes without a failure", async () => {
      await createOTPToken(testEmail, generateOTP());
      for (let i = 0; i < 3; i++) {
        await verifyOTPToken(testEmail, "000000");
      }
      await db
        .update(otpTokens)
        .set({ lastAttemptAt: sixteenMinutesAgo() })
        .where(eq(otpTokens.email, testEmail));

      await createOTPToken(testEmail, generateOTP());

      const result = await verifyOTPToken(testEmail, "000000");
      expect(result.attemptsRemaining).toBe(4);
    });

    it("clears a lockout that has ended", async () => {
      await createOTPToken(testEmail, generateOTP());
      for (let i = 0; i < 5; i++) {
        await verifyOTPToken(testEmail, "000000");
      }
      await db
        .update(otpTokens)
        .set({ lockedUntil: new Date(Date.now() - 60 * 1000), lastAttemptAt: sixteenMinutesAgo() })
        .where(eq(otpTokens.email, testEmail));

      const otp = generateOTP();
      await createOTPToken(testEmail, otp);

      expect((await verifyOTPToken(testEmail, otp)).success).toBe(true);
    });
  });

  describe("deleteOTPToken", () => {
    it("should delete OTP token", async () => {
      const otp = generateOTP();
      await createOTPToken(testEmail, otp, "127.0.0.1");

      await deleteOTPToken(testEmail);

      const tokens = await db.select().from(otpTokens);
      expect(tokens).toHaveLength(0);
    });

    it("should not throw when deleting non-existent token", async () => {
      await expect(deleteOTPToken("nonexistent@example.com")).resolves.not.toThrow();
    });
  });

  describe("cleanupExpiredOTPTokens", () => {
    it("should delete expired tokens", async () => {
      const otp1 = generateOTP();
      const otp2 = generateOTP();

      await createOTPToken("user1@example.com", otp1, "127.0.0.1");
      await createOTPToken("user2@example.com", otp2, "127.0.0.1");

      // Expire first token - use a fixed past date to be absolutely sure
      // Expire first token - use a fixed past date to be absolutely sure
      await db
        .update(otpTokens)
        .set({ expires: new Date("2000-01-01") })
        .where(eq(otpTokens.email, "user1@example.com"));

      const deleted = await cleanupExpiredOTPTokens();

      expect(deleted).toBe(1);

      const tokens = await db.select().from(otpTokens);
      expect(tokens).toHaveLength(1);
      const token = requireDefined(tokens[0], "Expected remaining valid OTP token");
      expect(token.email).toBe("user2@example.com");
    });

    it("should not delete valid tokens", async () => {
      const otp = generateOTP();
      await createOTPToken(testEmail, otp, "127.0.0.1");

      const deleted = await cleanupExpiredOTPTokens();

      expect(deleted).toBe(0);

      const tokens = await db.select().from(otpTokens);
      expect(tokens).toHaveLength(1);
    });
  });
});
