import { describe, expect, it, vi } from "vitest";
import { Resend } from "resend";
import OTPEmail from "@/emails/otp-email";
import {
  acceptEmail,
  codeFromHtml,
  createSmokeOutbox,
} from "../../../scripts/smoke-email-server.mjs";

const copy = {
  preview: "preview",
  heading: "heading",
  intro: "intro",
  codeLabel: "code",
  expiry: "5 minutes",
  warning: "warning",
  footer: "footer",
};

function otpEmail(otp: string) {
  return OTPEmail({ otp, host: "127.0.0.1", expiresInMinutes: 5, copy });
}

/**
 * The OTP smoke spec signs in with whatever this outbox says was sent, so the
 * code it reads out of an email and the Resend request it accepts have to be
 * what the application really produces. Both are pinned against the real email
 * template and the real SDK here, because a mismatch would otherwise surface
 * only as a failed production smoke run.
 */
describe("smoke email outbox", () => {
  it("reads the code out of the rendered OTP email, not out of its styles", async () => {
    const { render } = await import("@react-email/render");
    const html = await render(otpEmail("042917"));

    expect(html).toMatch(/#[0-9a-f]{6}/i);
    expect(codeFromHtml(html)).toBe("042917");
    expect(codeFromHtml("<p>no code here</p>")).toBeNull();
  });

  it("answers the newest message to an address, whatever its case", () => {
    const outbox = createSmokeOutbox();
    outbox.add({ to: "Owner@Example.com", subject: "first", html: "<p>111111</p>" });
    outbox.add({ to: ["someone@example.com"], subject: "other", html: "<p>222222</p>" });
    outbox.add({ to: ["owner@example.com"], subject: "second", html: "<p>333333</p>" });

    expect(outbox.latestTo("OWNER@example.com")).toEqual({ subject: "second", code: "333333" });
    expect(outbox.latestTo("nobody@example.com")).toBeNull();
  });

  it("accepts what the Resend SDK sends, at the path it sends it to", async () => {
    const outbox = createSmokeOutbox();
    const requests: string[] = [];
    // Unit tests refuse real sockets, so the SDK's fetch is answered by the
    // same function the HTTP server calls; the smoke run covers the transport.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      requests.push(`${init?.method} ${String(input)}`);
      const { status, body } = acceptEmail(outbox, JSON.parse(String(init?.body)));
      return Response.json(body, { status });
    });
    try {
      const result = await new Resend("re_smoke_unused", {
        baseUrl: "http://127.0.0.1:9",
      }).emails.send({
        from: "Cashier <noreply@example.com>",
        to: "owner@example.com",
        subject: "Cashier 验证码",
        react: otpEmail("635184"),
      });

      expect(result.error).toBeNull();
      expect(result.data?.id).toEqual(expect.any(String));
      expect(requests).toEqual(["POST http://127.0.0.1:9/emails"]);
      expect(outbox.latestTo("owner@example.com")).toEqual({
        subject: "Cashier 验证码",
        code: "635184",
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("refuses an email without a recipient or a body the way Resend does", () => {
    expect(acceptEmail(createSmokeOutbox(), { subject: "no one" })).toMatchObject({
      status: 422,
      body: { name: "validation_error" },
    });
  });
});
