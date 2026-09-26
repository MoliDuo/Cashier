import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { render } from "@react-email/render";
import { otpTokens } from "@/persistence/schema/auth";
import { getTestDb } from "tests/setup";
import { loginEmails } from "@/persistence";
import { TEST_USER_ID } from "tests/helpers/schema-setup";

const { headersMock, cookiesMock, resendSendMock } = vi.hoisted(() => ({
  headersMock: vi.fn(),
  cookiesMock: vi.fn(),
  resendSendMock: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: headersMock,
  cookies: cookiesMock,
}));

vi.mock("resend", () => ({
  Resend: class MockResend {
    emails = {
      send: resendSendMock,
    };
  },
}));

import { sendOTPAction } from "@/modules/auth/server-actions/send-otp";

describe("sendOTPAction edge cases", () => {
  const _originalResendKey = process.env.AUTH_RESEND_KEY;
  const _originalEmailFrom = process.env.AUTH_EMAIL_FROM;
  const testEmail = "edge-auth@example.com";

  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.AUTH_RESEND_KEY;
    delete process.env.AUTH_EMAIL_FROM;

    const db = getTestDb();
    await db
      .update(loginEmails)
      .set({ email: testEmail })
      .where(eq(loginEmails.userId, TEST_USER_ID));
    await db.delete(otpTokens).where(eq(otpTokens.email, testEmail));

    headersMock.mockResolvedValue({
      get: (key: string) => {
        if (key === "x-forwarded-for") return "203.0.113.18";
        return null;
      },
    });
    cookiesMock.mockResolvedValue({
      get: () => undefined,
    });
    resendSendMock.mockResolvedValue({ data: { id: "test-email-id" }, error: null });
  });

  it("uses localhost when host header is missing and still creates token", async () => {
    process.env.AUTH_RESEND_KEY = "test-resend-key";

    await sendOTPAction(testEmail);

    expect(resendSendMock).toHaveBeenCalledTimes(1);
    const firstCall = resendSendMock.mock.calls[0]?.[0];
    const renderedEmail = await render(firstCall?.react);
    expect(renderedEmail).toContain("登录 localhost</h1>");
    expect(firstCall?.to).toBe(testEmail);

    const db = getTestDb();
    const token = await db.query.otpTokens.findFirst({
      where: eq(otpTokens.email, testEmail),
    });
    expect(token).toBeDefined();
  });

  it("returns a stable error code when email provider send fails", async () => {
    process.env.AUTH_RESEND_KEY = "test-resend-key";
    resendSendMock.mockRejectedValueOnce(new Error("provider down"));

    await expect(sendOTPAction(testEmail)).resolves.toEqual({
      ok: false,
      code: "email_send_failed",
    });
  });

  it("sends nothing to a locked-out address but answers as if it had", async () => {
    process.env.AUTH_RESEND_KEY = "test-resend-key";
    const lockedUntil = new Date(Date.now() + 10 * 60 * 1000);
    await getTestDb()
      .insert(otpTokens)
      .values({
        email: testEmail,
        tokenHash: "locked-token-hash",
        expires: new Date(Date.now() + 60 * 1000),
        attempts: 5,
        lockedUntil,
      });

    await expect(sendOTPAction(testEmail)).resolves.toMatchObject({ ok: true });

    expect(resendSendMock).not.toHaveBeenCalled();
    const token = await getTestDb().query.otpTokens.findFirst({
      where: eq(otpTokens.email, testEmail),
    });
    expect(token).toMatchObject({ tokenHash: "locked-token-hash", attempts: 5, lockedUntil });
  });

  it("answers an unknown address like a real send but stores and sends nothing", async () => {
    process.env.AUTH_RESEND_KEY = "test-resend-key";

    await expect(sendOTPAction("nobody@example.com")).resolves.toMatchObject({
      ok: true,
      expiresIn: 300,
    });

    expect(resendSendMock).not.toHaveBeenCalled();
    await expect(
      getTestDb().query.otpTokens.findFirst({ where: eq(otpTokens.email, "nobody@example.com") })
    ).resolves.toBeUndefined();
  });

  it("discards the unsent code and frees the cooldown when the provider fails", async () => {
    process.env.AUTH_RESEND_KEY = "test-resend-key";
    resendSendMock.mockRejectedValueOnce(new Error("provider down"));

    await expect(sendOTPAction(testEmail)).resolves.toMatchObject({ code: "email_send_failed" });
    await expect(
      getTestDb().query.otpTokens.findFirst({ where: eq(otpTokens.email, testEmail) })
    ).resolves.toBeUndefined();

    // The reader can ask again at once instead of waiting out a cooldown for
    // an email that never arrived.
    await expect(sendOTPAction(testEmail)).resolves.toMatchObject({ ok: true });
    expect(resendSendMock).toHaveBeenCalledTimes(2);
  });

  it("sends the Chinese email from the configured sender with the expiry in minutes", async () => {
    process.env.AUTH_RESEND_KEY = "test-resend-key";
    process.env.AUTH_EMAIL_FROM = "Cashier <login@cashier.example>";

    await sendOTPAction(testEmail);

    const message = resendSendMock.mock.calls[0]?.[0];
    expect(message).toMatchObject({
      from: "Cashier <login@cashier.example>",
      to: testEmail,
      subject: "Cashier 验证码",
    });
    expect(await render(message?.react)).toContain("5 分钟");
  });

  it("limits sends per client address across different emails", async () => {
    process.env.AUTH_RESEND_KEY = "test-resend-key";

    for (let index = 0; index < 10; index += 1) {
      await expect(sendOTPAction(`someone-${index}@example.com`)).resolves.toMatchObject({
        ok: true,
      });
    }

    const limited = await sendOTPAction("someone-else@example.com");
    expect(limited).toMatchObject({ ok: false, code: "rate_limited" });
    expect(limited.ok ? 0 : limited.retryAfter).toBeGreaterThan(0);
  });
});
