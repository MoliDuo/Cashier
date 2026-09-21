import { beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitError } from "@/lib/errors";

const { headersMock, cookiesMock, sendOTPMock } = vi.hoisted(() => ({
  headersMock: vi.fn(),
  cookiesMock: vi.fn(),
  sendOTPMock: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: headersMock,
  cookies: cookiesMock,
}));

vi.mock("@/modules/auth/application/use-cases/send-otp", () => ({
  sendOTP: sendOTPMock,
}));

import { sendOTPAction } from "@/modules/auth/server-actions/send-otp";

describe("sendOTPAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TRUSTED_PROXY;
    cookiesMock.mockResolvedValue({
      get: () => undefined,
    });
    sendOTPMock.mockResolvedValue({
      expiresIn: 300,
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      canResendAt: null,
    });
  });

  it("ignores forwarded IP headers when trusted proxy mode is disabled", async () => {
    headersMock.mockResolvedValue({
      get: (key: string) => {
        if (key === "x-forwarded-for") return "203.0.113.7, 10.0.0.1";
        if (key === "host") return "cashier.example";
        return null;
      },
    });

    await expect(sendOTPAction("User@Example.com")).resolves.toMatchObject({ ok: true });

    expect(sendOTPMock).toHaveBeenCalledWith(
      { email: "User@Example.com", ip: "unknown", host: "cashier.example" },
      expect.any(Object)
    );
  });

  it("returns invalid_email before invoking use case", async () => {
    headersMock.mockResolvedValue({
      get: (_key: string) => null,
    });

    await expect(sendOTPAction("not-an-email")).resolves.toEqual({
      ok: false,
      code: "invalid_email",
    });
    expect(sendOTPMock).not.toHaveBeenCalled();
  });

  it("returns a stable rate-limit result with retry timing", async () => {
    headersMock.mockResolvedValue({
      get: (_key: string) => null,
    });
    sendOTPMock.mockRejectedValueOnce(new RateLimitError("wait", 42));

    await expect(sendOTPAction("test@example.com")).resolves.toEqual({
      ok: false,
      code: "rate_limited",
      retryAfter: 42,
    });
  });

  it("falls back to unknown ip and localhost host", async () => {
    headersMock.mockResolvedValue({
      get: (_key: string) => null,
    });

    await sendOTPAction("test@example.com");

    expect(sendOTPMock).toHaveBeenCalledWith(
      { email: "test@example.com", ip: "unknown", host: "localhost" },
      expect.any(Object)
    );
  });

  it("prefers x-real-ip when TRUSTED_PROXY is configured", async () => {
    process.env.TRUSTED_PROXY = "platform";

    headersMock.mockResolvedValue({
      get: (key: string) => {
        if (key === "x-real-ip") return "198.51.100.12";
        if (key === "x-forwarded-for") return "203.0.113.7";
        if (key === "host") return "cashier.example";
        return null;
      },
    });

    await sendOTPAction("test@example.com");

    expect(sendOTPMock).toHaveBeenCalledWith(
      {
        email: "test@example.com",
        ip: "198.51.100.12",
        host: "cashier.example",
      },
      expect.any(Object)
    );
  });
});
