import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_ERROR_CODES } from "@/modules/auth/errors";
import type { OtpTokenPort, UserAccountPort } from "@/application/contracts";

const {
  findOTPRecordMock,
  verifyOTPWithPolicyMock,
  consumeOTPClaimMock,
  releaseOTPClaimMock,
  checkVerifyRateLimitMock,
  assertMemberLoginAllowedMock,
  getClientIPFromHeadersMock,
  dbUserFindFirstMock,
  dbInsertValuesMock,
  dbInsertReturningMock,
  loggerWarnMock,
} = vi.hoisted(() => ({
  findOTPRecordMock: vi.fn(),
  verifyOTPWithPolicyMock: vi.fn(),
  consumeOTPClaimMock: vi.fn(),
  releaseOTPClaimMock: vi.fn(),
  checkVerifyRateLimitMock: vi.fn(),
  assertMemberLoginAllowedMock: vi.fn(),
  getClientIPFromHeadersMock: vi.fn(),
  dbUserFindFirstMock: vi.fn(),
  dbInsertValuesMock: vi.fn(),
  dbInsertReturningMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock("@/modules/auth/services/otp-verification", () => ({
  findOTPRecord: findOTPRecordMock,
  verifyOTPWithPolicy: verifyOTPWithPolicyMock,
  consumeOTPClaim: consumeOTPClaimMock,
  releaseOTPClaim: releaseOTPClaimMock,
}));

vi.mock("@/modules/auth/services/otp-rate-limit", () => ({
  checkVerifyRateLimit: checkVerifyRateLimitMock,
}));

vi.mock("@/modules/auth/application/use-cases/member-login-policy", () => ({
  assertMemberLoginAllowed: assertMemberLoginAllowedMock,
}));

vi.mock("@/lib/utils/ip", () => ({
  getClientIPFromHeaders: getClientIPFromHeadersMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      users: {
        findFirst: dbUserFindFirstMock,
      },
    },
    insert: vi.fn(() => ({
      values: dbInsertValuesMock,
    })),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: loggerWarnMock,
    debug: vi.fn(),
    child: vi.fn(() => ({
      warn: loggerWarnMock,
      debug: vi.fn(),
    })),
  },
}));

import {
  authenticateWithOTP as authenticateWithOTPUseCase,
  OTPInvalidSignInError,
  OTPLockedSignInError,
  OTPRateLimitedSignInError,
} from "@/modules/auth/application/use-cases/authenticate-with-otp";

const otpTokens = {} as OtpTokenPort;
const fallbackUsers = {} as UserAccountPort;
const rateLimiter = {} as import("@/application/contracts").RateLimiterPort;
const authenticateWithOTP = (
  input: Parameters<typeof authenticateWithOTPUseCase>[0],
  users: UserAccountPort = fallbackUsers
) => authenticateWithOTPUseCase(input, { userAccounts: users, otpTokens, rateLimiter });

describe("authenticateWithOTP additional coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    findOTPRecordMock.mockResolvedValue({
      id: "otp-id",
      email: "new-user@example.com",
      tokenHash: "hash",
      expires: new Date(Date.now() + 60_000),
      attempts: 0,
      createdAt: new Date(),
      lastAttemptAt: null,
      lockedUntil: null,
      verifiedAt: null,
      ipAddress: "127.0.0.1",
    });
    checkVerifyRateLimitMock.mockResolvedValue(true);
    verifyOTPWithPolicyMock.mockResolvedValue({ success: true });
    consumeOTPClaimMock.mockResolvedValue(true);
    releaseOTPClaimMock.mockResolvedValue(undefined);
    assertMemberLoginAllowedMock.mockResolvedValue({
      id: "existing-user-id",
      email: "new-user@example.com",
      name: null,
      image: null,
      authVersion: 1,
    });
    dbUserFindFirstMock.mockResolvedValue(null);
    dbInsertReturningMock.mockResolvedValue([
      {
        id: "new-user-id",
        email: "new-user@example.com",
        name: null,
        image: null,
      },
    ]);
    dbInsertValuesMock.mockReturnValue({
      returning: dbInsertReturningMock,
    });
    getClientIPFromHeadersMock.mockReturnValue("127.0.0.1");
  });

  it("returns an existing member without creating an account", async () => {
    const users = {} as UserAccountPort;
    const result = await authenticateWithOTP(
      {
        email: "NEW-USER@EXAMPLE.COM",
        otp: "123456",
        requestHeaders: new Headers(),
      },
      users
    );

    expect(assertMemberLoginAllowedMock).toHaveBeenCalledWith("new-user@example.com", users);
    expect(result).toEqual({
      id: "existing-user-id",
      email: "new-user@example.com",
      name: null,
      image: null,
      authVersion: 1,
      locale: "zh",
      pendingOtpClaim: { email: "new-user@example.com", tokenHash: "hash" },
    });
    expect(consumeOTPClaimMock).not.toHaveBeenCalled();
  });

  it("returns the existing user with a pending OTP claim", async () => {
    const users = {} as UserAccountPort;

    const result = await authenticateWithOTP(
      { email: "new-user@example.com", otp: "123456", requestHeaders: new Headers() },
      users
    );

    expect(result.pendingOtpClaim).toEqual({
      email: "new-user@example.com",
      tokenHash: "hash",
    });
    expect(consumeOTPClaimMock).not.toHaveBeenCalled();
  });

  it("releases the OTP claim when member lookup fails", async () => {
    const setupError = new Error("user setup unavailable");
    const users = {} as UserAccountPort;
    assertMemberLoginAllowedMock.mockRejectedValueOnce(setupError);

    await expect(
      authenticateWithOTP(
        { email: "new-user@example.com", otp: "123456", requestHeaders: new Headers() },
        users
      )
    ).rejects.toBe(setupError);

    expect(consumeOTPClaimMock).not.toHaveBeenCalled();
    expect(releaseOTPClaimMock).toHaveBeenCalledWith(
      { email: "new-user@example.com", tokenHash: "hash" },
      otpTokens
    );
  });

  it("throws otp_invalid when OTP record is missing", async () => {
    findOTPRecordMock.mockResolvedValueOnce(null);

    await expect(
      authenticateWithOTP({
        email: "missing@example.com",
        otp: "123456",
        requestHeaders: new Headers(),
      })
    ).rejects.toBeInstanceOf(OTPInvalidSignInError);
  });

  it("throws otp_rate_limited when verify rate-limit denies request", async () => {
    checkVerifyRateLimitMock.mockResolvedValueOnce(false);

    await expect(
      authenticateWithOTP({
        email: "new-user@example.com",
        otp: "123456",
        requestHeaders: new Headers(),
      })
    ).rejects.toBeInstanceOf(OTPRateLimitedSignInError);

    expect(verifyOTPWithPolicyMock).not.toHaveBeenCalled();
  });

  it("maps max_attempts result to otp_locked", async () => {
    verifyOTPWithPolicyMock.mockResolvedValueOnce({
      success: false,
      reason: "max_attempts",
      attemptsRemaining: 0,
    });

    await expect(
      authenticateWithOTP({
        email: "new-user@example.com",
        otp: "000000",
        requestHeaders: new Headers(),
      })
    ).rejects.toBeInstanceOf(OTPLockedSignInError);
  });

  it("throws otp_invalid for malformed OTP format", async () => {
    await expect(
      authenticateWithOTP({
        email: "new-user@example.com",
        otp: "abc",
        requestHeaders: new Headers(),
      })
    ).rejects.toMatchObject({ code: AUTH_ERROR_CODES.OTP_INVALID });
  });
});
