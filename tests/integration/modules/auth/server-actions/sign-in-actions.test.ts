import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestDb } from "tests/setup";
import { otpTokens, sessions } from "@/persistence";
import { hashOTP } from "@/modules/auth/domain/otp";
import { DEV_AUTH_EMAIL } from "@/modules/auth/dev-auth";
import { SESSION_COOKIE_NAME } from "@/modules/auth/constants";
import { createTestUserWithLedger } from "tests/helpers/schema-setup";

const jar = vi.hoisted(() => new Map<string, string>());

// The shared setup stands in a session; these tests sign in for real.
vi.unmock("@/modules/auth/server/current-session");

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "127.0.0.1" }),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

import {
  devSignInAction,
  signInWithOtpAction,
  signOutAction,
} from "@/modules/auth/server-actions/sign-in";
import { getCurrentSession } from "@/modules/auth/server/current-session";
import { requireAuth } from "@/modules/auth/server/session-guards";

const EMAIL = "owner@example.com";

describe("sign-in actions", () => {
  const originalBypass = process.env.DEV_AUTH_BYPASS;

  beforeEach(() => jar.clear());

  afterEach(() => {
    if (originalBypass == null) delete process.env.DEV_AUTH_BYPASS;
    else process.env.DEV_AUTH_BYPASS = originalBypass;
  });

  it("signs in with an OTP, and the cookie then names the session", async () => {
    const { userId } = await createTestUserWithLedger(getTestDb(), EMAIL);
    await getTestDb()
      .insert(otpTokens)
      .values({
        email: EMAIL,
        tokenHash: hashOTP("123456"),
        expires: new Date(Date.now() + 5 * 60 * 1000),
      });

    await expect(signInWithOtpAction(EMAIL, "123456")).resolves.toEqual({ ok: true });

    expect(jar.get(SESSION_COOKIE_NAME)).toMatch(/^[\w-]{43}$/);
    await expect(getCurrentSession()).resolves.toMatchObject({ userId, email: EMAIL });
    await expect(requireAuth()).resolves.toBe(userId);
  });

  it("returns the failure code and opens no session for a wrong code", async () => {
    await createTestUserWithLedger(getTestDb(), EMAIL);
    await getTestDb()
      .insert(otpTokens)
      .values({
        email: EMAIL,
        tokenHash: hashOTP("123456"),
        expires: new Date(Date.now() + 5 * 60 * 1000),
      });

    await expect(signInWithOtpAction(EMAIL, "654321")).resolves.toEqual({
      ok: false,
      code: "otp_invalid",
    });
    expect(jar.has(SESSION_COOKIE_NAME)).toBe(false);
    expect(await getTestDb().select().from(sessions)).toEqual([]);
  });

  it("replaces the browser's previous session when it signs in again", async () => {
    process.env.DEV_AUTH_BYPASS = "true";
    await createTestUserWithLedger(getTestDb(), DEV_AUTH_EMAIL);

    await devSignInAction();
    const first = jar.get(SESSION_COOKIE_NAME);
    await devSignInAction();

    expect(jar.get(SESSION_COOKIE_NAME)).not.toBe(first);
    expect(await getTestDb().select().from(sessions)).toHaveLength(1);
  });

  it("refuses the dev sign-in when the bypass is off", async () => {
    process.env.DEV_AUTH_BYPASS = "false";
    await createTestUserWithLedger(getTestDb(), DEV_AUTH_EMAIL);

    await expect(devSignInAction()).resolves.toEqual({
      ok: false,
      code: "invalid_credentials",
    });
    expect(jar.has(SESSION_COOKIE_NAME)).toBe(false);
  });

  it("signs out by deleting the session and the cookie", async () => {
    process.env.DEV_AUTH_BYPASS = "true";
    await createTestUserWithLedger(getTestDb(), DEV_AUTH_EMAIL);
    await devSignInAction();

    await signOutAction();

    expect(jar.has(SESSION_COOKIE_NAME)).toBe(false);
    expect(await getTestDb().select().from(sessions)).toEqual([]);
    await expect(getCurrentSession()).resolves.toBeNull();
  });
});
