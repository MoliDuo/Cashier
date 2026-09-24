import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  createOTPTokenMock,
  discardOTPTokenMock,
  acquireResendCooldownMock,
  checkSendRateLimitMock,
  checkSendRateLimitByIPMock,
  releaseResendCooldownMock,
  generateOTPMock,
  getResendCooldownMock,
  otpEmailMock,
  resendSendMock,
  loggerWarnMock,
  loggerInfoMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  createOTPTokenMock: vi.fn(),
  discardOTPTokenMock: vi.fn(),
  acquireResendCooldownMock: vi.fn(),
  checkSendRateLimitMock: vi.fn(),
  checkSendRateLimitByIPMock: vi.fn(),
  releaseResendCooldownMock: vi.fn(),
  generateOTPMock: vi.fn(),
  getResendCooldownMock: vi.fn(),
  otpEmailMock: vi.fn(),
  resendSendMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("@/modules/auth/repositories/otp-repository", () => ({
  createOTPToken: createOTPTokenMock,
  discardOTPToken: discardOTPTokenMock,
}));

vi.mock("@/modules/auth/services/otp-rate-limit", () => ({
  acquireResendCooldown: acquireResendCooldownMock,
  checkSendRateLimit: checkSendRateLimitMock,
  checkSendRateLimitByIP: checkSendRateLimitByIPMock,
  releaseResendCooldown: releaseResendCooldownMock,
}));

vi.mock("@/modules/auth/services/otp", () => ({
  generateOTP: generateOTPMock,
  getResendCooldown: getResendCooldownMock,
}));

vi.mock("@/emails/otp-email", () => ({
  default: otpEmailMock,
}));

vi.mock("resend", () => ({
  Resend: class MockResend {
    emails = {
      send: resendSendMock,
    };
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: loggerWarnMock,
    info: loggerInfoMock,
    error: loggerErrorMock,
    debug: vi.fn(),
    child: vi.fn(() => ({
      warn: loggerWarnMock,
      info: loggerInfoMock,
      error: loggerErrorMock,
      debug: vi.fn(),
    })),
  },
}));

import { RateLimitError } from "@/lib/errors";
import { sendOTP as sendOTPUseCase } from "@/modules/auth/application/use-cases/send-otp";
import { serverComposition } from "@/application/server-composition-root";
import type { OtpTokenPort, UserAccountPort } from "@/application/contracts";

const tokens = {} as OtpTokenPort;
const users = {
  findByEmail: vi.fn().mockResolvedValue({ id: "user-1", registrationCompletedAt: new Date() }),
} as unknown as UserAccountPort;
const sendOTP = (input: Parameters<typeof sendOTPUseCase>[0]) =>
  sendOTPUseCase(input, {
    emailDelivery: serverComposition.email,
    tokens,
    users,
    rateLimiter: serverComposition.rateLimiter,
  });

type SendOTPInput = Parameters<typeof sendOTP>[0];

function validEmail(email: string) {
  return email as SendOTPInput["email"];
}

describe("sendOTP use case", () => {
  const originalResendKey = process.env.AUTH_RESEND_KEY;
  const originalEmailFrom = process.env.AUTH_EMAIL_FROM;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AUTH_RESEND_KEY;
    delete process.env.AUTH_EMAIL_FROM;

    createOTPTokenMock.mockResolvedValue({
      expiresAt: new Date(Date.now() + 300_000),
      success: true,
      tokenHash: "token-hash-1",
    });
    discardOTPTokenMock.mockResolvedValue(true);
    acquireResendCooldownMock.mockResolvedValue({
      acquired: true,
      acquiredAt: new Date(1_234_567_830_000),
      retryAfter: 0,
    });
    checkSendRateLimitMock.mockResolvedValue({
      allowed: true,
      remainingAttempts: 9,
    });
    checkSendRateLimitByIPMock.mockResolvedValue({
      allowed: true,
      remainingAttempts: 9,
    });
    releaseResendCooldownMock.mockResolvedValue(true);
    generateOTPMock.mockReturnValue("123456");
    getResendCooldownMock.mockReturnValue(60);
    otpEmailMock.mockReturnValue({ kind: "otp-email-component" });
    resendSendMock.mockResolvedValue({ data: { id: "mail-id" }, error: null });
  });

  afterEach(() => {
    if (originalResendKey == null) {
      delete process.env.AUTH_RESEND_KEY;
    } else {
      process.env.AUTH_RESEND_KEY = originalResendKey;
    }

    if (originalEmailFrom == null) {
      delete process.env.AUTH_EMAIL_FROM;
    } else {
      process.env.AUTH_EMAIL_FROM = originalEmailFrom;
    }
  });

  it("rejects when IP rate limit is exceeded", async () => {
    process.env.AUTH_RESEND_KEY = "resend-key";
    checkSendRateLimitByIPMock.mockResolvedValueOnce({
      allowed: false,
      retryAfter: 120,
    });

    await expect(
      sendOTP({
        email: validEmail("test@example.com"),
        ip: "203.0.113.9",
        host: "cashier.example",
      })
    ).rejects.toThrow(RateLimitError);
  });

  it("passes host into OTPEmail and uses fallback AUTH_EMAIL_FROM", async () => {
    process.env.AUTH_RESEND_KEY = "resend-key";

    const result = await sendOTP({
      email: validEmail("User@Example.COM"),
      ip: "203.0.113.2",
      host: "cashier.example",
    });

    expect(createOTPTokenMock).toHaveBeenCalledWith(
      "user@example.com",
      "123456",
      tokens,
      "203.0.113.2"
    );
    expect(otpEmailMock).toHaveBeenCalledWith({
      otp: "123456",
      host: "cashier.example",
      expiresInMinutes: 5,
      copy: expect.objectContaining({
        heading: "登录 cashier.example",
        codeLabel: "您的验证码：",
      }),
    });
    expect(resendSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Cashier <noreply@example.com>",
        to: "user@example.com",
        subject: "Cashier 验证码",
        react: { kind: "otp-email-component" },
      })
    );
    expect(acquireResendCooldownMock).toHaveBeenCalledWith(
      "user@example.com",
      expect.objectContaining({ increment: expect.any(Function) })
    );
    expect(result.canResendAt).toBe(1_234_567_890);
  });

  it("renders the OTP expiry in whole minutes", async () => {
    process.env.AUTH_RESEND_KEY = "resend-key";

    await sendOTP({
      email: validEmail("test@example.com"),
      ip: "203.0.113.2",
      host: "cashier.example",
    });

    expect(otpEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        expiresInMinutes: 5,
        copy: expect.objectContaining({ expiry: expect.stringContaining("5") }),
      })
    );
  });

  it("throws user-facing error when resend send fails", async () => {
    process.env.AUTH_RESEND_KEY = "resend-key";
    resendSendMock.mockRejectedValueOnce(new Error("smtp down"));

    await expect(
      sendOTP({
        email: validEmail("test@example.com"),
        ip: "127.0.0.1",
        host: "cashier.example",
      })
    ).rejects.toThrow("Failed to send verification code. Please try again.");

    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringMatching(/^email:[a-f0-9]{16}$/) }),
      "Failed to send OTP email"
    );
    expect(discardOTPTokenMock).toHaveBeenCalledWith("test@example.com", "token-hash-1", tokens);
    expect(releaseResendCooldownMock).toHaveBeenCalledWith(
      "test@example.com",
      new Date(1_234_567_830_000),
      expect.any(Object)
    );
  });

  it("releases the resend cooldown when token creation fails", async () => {
    process.env.AUTH_RESEND_KEY = "resend-key";
    createOTPTokenMock.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      sendOTP({
        email: validEmail("test@example.com"),
        ip: "127.0.0.1",
        host: "cashier.example",
      })
    ).rejects.toThrow("Failed to send verification code. Please try again.");

    expect(discardOTPTokenMock).not.toHaveBeenCalled();
    expect(releaseResendCooldownMock).toHaveBeenCalledWith(
      "test@example.com",
      new Date(1_234_567_830_000),
      expect.any(Object)
    );
  });

  it("returns a virtual success without creating or sending a token for unknown users", async () => {
    process.env.AUTH_RESEND_KEY = "resend-key";
    const findByEmail = vi.fn().mockResolvedValue(null);

    const result = await sendOTPUseCase(
      {
        email: validEmail("new@example.com"),
        ip: "203.0.113.2",
        host: "cashier.example",
      },
      {
        emailDelivery: serverComposition.email,
        tokens,
        users: { findByEmail } as unknown as UserAccountPort,
        rateLimiter: serverComposition.rateLimiter,
      }
    );

    expect(result).toEqual({
      expiresIn: 300,
      expiresAt: expect.any(Number),
      canResendAt: expect.any(Number),
    });
    expect(findByEmail).toHaveBeenCalledWith("new@example.com");
    expect(createOTPTokenMock).not.toHaveBeenCalled();
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("builds a Chinese subject and localized OTP template props", async () => {
    process.env.AUTH_RESEND_KEY = "resend-key";

    await sendOTP({
      email: validEmail("user@example.com"),
      ip: "203.0.113.2",
      host: "cashier.example",
    });

    expect(otpEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "cashier.example",
        copy: expect.objectContaining({
          heading: "登录 cashier.example",
          codeLabel: "您的验证码：",
        }),
      })
    );
    expect(resendSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Cashier 验证码",
      })
    );
  });

  it("supports custom AUTH_EMAIL_FROM", async () => {
    process.env.AUTH_RESEND_KEY = "resend-key";
    process.env.AUTH_EMAIL_FROM = "security@cashier.example";

    await sendOTP({
      email: validEmail("test@example.com"),
      ip: "127.0.0.1",
      host: "cashier.example",
    });

    expect(resendSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "security@cashier.example",
      })
    );
    expect(loggerInfoMock).toHaveBeenCalledWith(
      { subject: expect.stringMatching(/^email:[a-f0-9]{16}$/) },
      "OTP email sent successfully"
    );
  });
});
