import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestDb } from "tests/setup";
import { createTestUserWithLedger } from "tests/helpers/schema-setup";
import { DEV_AUTH_EMAIL } from "@/modules/auth/dev-auth";
import { SESSION_COOKIE_NAME, SIGNED_OUT_COOKIE_NAME } from "@/modules/auth/constants";
import { sessions } from "@/persistence";

const jar = vi.hoisted(() => new Map<string, string>());

// The shared setup stands in a session; this signs in and out for real.
vi.unmock("@/modules/auth/server/current-session");

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

import { POST } from "@/app/api/auth/logout/route";
import { devSignInAction } from "@/modules/auth/server-actions/sign-in";
import { getCurrentSession } from "@/modules/auth/server/current-session";

describe("POST /api/auth/logout", () => {
  const originalBypass = process.env.DEV_AUTH_BYPASS;

  beforeEach(() => jar.clear());

  afterEach(() => {
    if (originalBypass == null) delete process.env.DEV_AUTH_BYPASS;
    else process.env.DEV_AUTH_BYPASS = originalBypass;
  });

  it("deletes the session and the cookie, and says so", async () => {
    process.env.DEV_AUTH_BYPASS = "true";
    await createTestUserWithLedger(getTestDb(), DEV_AUTH_EMAIL);
    await devSignInAction();

    const response = await POST();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(jar.get(SESSION_COOKIE_NAME) ?? "").toBe("");
    expect(await getTestDb().select().from(sessions)).toEqual([]);
    await expect(getCurrentSession()).resolves.toBeNull();
  });

  it("leaves a minute-long marker so the login page does not sign the reader straight back in", async () => {
    const response = await POST();

    const marker = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith(`${SIGNED_OUT_COOKIE_NAME}=1`))
      ?.toLowerCase();
    expect(marker).toContain("max-age=60");
    expect(marker).toContain("path=/;");
    expect(marker).toContain("httponly");
    expect(marker).toContain("samesite=lax");
  });

  it("is fine to call without a session", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
  });
});
