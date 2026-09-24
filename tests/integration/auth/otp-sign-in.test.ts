import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { otpTokens } from "@/persistence/schema/auth";
import { AUTH_ERROR_CODES } from "@/modules/auth/errors";
import {
  authenticateWithOTP as authenticateWithOTPUseCase,
  OTPExpiredSignInError,
  OTPInvalidSignInError,
  OTPLockedSignInError,
  OTPRateLimitedSignInError,
} from "@/modules/auth/application/use-cases/authenticate-with-otp";
import { serverComposition } from "@/application/server-composition-root";
import { hashOTP } from "@/modules/auth/services/otp";
import { completeInteractiveSignIn } from "@/application/use-cases/complete-interactive-sign-in";
import { createTestUserWithLedger } from "../../helpers/schema-setup";

vi.mock("resend", () => ({
  Resend: class MockResend {
    emails = {
      send: vi.fn().mockResolvedValue({ data: { id: "test-email-id" }, error: null }),
    };
  },
}));

const TEST_EMAIL = "test@example.com";
const REQUEST_HEADERS = new Headers({ "x-real-ip": "127.0.0.1" });
const authenticateWithOTP = (input: Parameters<typeof authenticateWithOTPUseCase>[0]) =>
  authenticateWithOTPUseCase(input, {
    userAccounts: serverComposition.userAccounts,
    otpTokens: serverComposition.otpTokens,
    rateLimiter: serverComposition.rateLimiter,
  });

async function createTestOTP(email: string, otp: string, expiresAt?: Date) {
  const db = getTestDb();

  await db.insert(otpTokens).values({
    email: email.toLowerCase(),
    tokenHash: hashOTP(otp),
    expires: expiresAt ?? new Date(Date.now() + 5 * 60 * 1000),
    attempts: 0,
  });
}

describe("authenticateWithOTP", () => {
  const originalTrustedProxy = process.env.TRUSTED_PROXY;

  beforeEach(async () => {
    await createTestUserWithLedger(getTestDb(), TEST_EMAIL);
  });

  afterEach(() => {
    if (originalTrustedProxy == null) {
      delete process.env.TRUSTED_PROXY;
    } else {
      process.env.TRUSTED_PROXY = originalTrustedProxy;
    }
  });

  it("signs in successfully with a valid OTP", async () => {
    await createTestOTP(TEST_EMAIL, "123456");

    const principal = await authenticateWithOTP({
      email: TEST_EMAIL,
      otp: "123456",
      requestHeaders: REQUEST_HEADERS,
    });
    expect(principal).toMatchObject({ email: TEST_EMAIL });

    // Verifying spends the token; nothing downstream can hand it back.
    const db = getTestDb();
    expect(
      await db.query.otpTokens.findFirst({ where: eq(otpTokens.email, TEST_EMAIL) })
    ).toBeUndefined();

    await completeInteractiveSignIn(principal, { ledgers: serverComposition.ledgers });
  });

  it("returns otp_invalid for an incorrect OTP", async () => {
    await createTestOTP(TEST_EMAIL, "123456");

    let error: unknown;

    try {
      await authenticateWithOTP({
        email: TEST_EMAIL,
        otp: "999999",
        requestHeaders: REQUEST_HEADERS,
      });
    } catch (caughtError) {
      error = caughtError;
    }

    expect(error).toBeInstanceOf(OTPInvalidSignInError);
    expect(error).toMatchObject({ code: AUTH_ERROR_CODES.OTP_INVALID });

    const db = getTestDb();
    const token = await db.query.otpTokens.findFirst({
      where: eq(otpTokens.email, TEST_EMAIL),
    });
    expect(token?.attempts).toBe(1);
  });

  it("charges the IP verification bucket before looking up a token", async () => {
    process.env.TRUSTED_PROXY = "platform";
    const increment = vi.spyOn(serverComposition.rateLimiter, "increment");

    await expect(
      authenticateWithOTP({
        email: "missing-token@example.com",
        otp: "123456",
        requestHeaders: REQUEST_HEADERS,
      })
    ).rejects.toMatchObject({ code: AUTH_ERROR_CODES.OTP_INVALID });

    expect(increment).toHaveBeenCalledTimes(1);
    increment.mockRestore();
  });

  it("returns otp_expired for an expired OTP", async () => {
    await createTestOTP(TEST_EMAIL, "123456", new Date(Date.now() - 1000));

    await expect(
      authenticateWithOTP({
        email: TEST_EMAIL,
        otp: "123456",
        requestHeaders: REQUEST_HEADERS,
      })
    ).rejects.toBeInstanceOf(OTPExpiredSignInError);

    await expect(
      authenticateWithOTP({
        email: TEST_EMAIL,
        otp: "123456",
        requestHeaders: REQUEST_HEADERS,
      })
    ).rejects.toMatchObject({ code: AUTH_ERROR_CODES.OTP_EXPIRED });
  });

  it("returns otp_locked after too many failed attempts", async () => {
    await createTestOTP(TEST_EMAIL, "123456");

    let error: unknown;

    for (let i = 0; i < 5; i++) {
      try {
        await authenticateWithOTP({
          email: TEST_EMAIL,
          otp: "999999",
          requestHeaders: REQUEST_HEADERS,
        });
      } catch (caughtError) {
        error = caughtError;
      }
    }

    expect(error).toBeInstanceOf(OTPLockedSignInError);
    expect(error).toMatchObject({ code: AUTH_ERROR_CODES.OTP_LOCKED });

    const db = getTestDb();
    const token = await db.query.otpTokens.findFirst({
      where: eq(otpTokens.email, TEST_EMAIL),
    });
    expect(token?.lockedUntil).toBeInstanceOf(Date);
  });

  it("returns otp_rate_limited when verify attempts exceed the IP limit", async () => {
    process.env.TRUSTED_PROXY = "platform";
    await createTestOTP(TEST_EMAIL, "123456");

    for (let i = 0; i < 5; i++) {
      try {
        await authenticateWithOTP({
          email: TEST_EMAIL,
          otp: "999999",
          requestHeaders: REQUEST_HEADERS,
        });
      } catch {
        // Expected invalid attempts before the IP-level rate limit kicks in.
      }
    }

    await expect(
      authenticateWithOTP({
        email: TEST_EMAIL,
        otp: "999999",
        requestHeaders: REQUEST_HEADERS,
      })
    ).rejects.toBeInstanceOf(OTPRateLimitedSignInError);

    await expect(
      authenticateWithOTP({
        email: TEST_EMAIL,
        otp: "999999",
        requestHeaders: REQUEST_HEADERS,
      })
    ).rejects.toMatchObject({ code: AUTH_ERROR_CODES.OTP_RATE_LIMITED });
  });
});
