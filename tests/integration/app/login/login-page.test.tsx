import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestDb } from "tests/setup";
import { createTestUser } from "tests/helpers/schema-setup";
import { loginEmails, users } from "@/persistence";

const jar = vi.hoisted(() => new Set<string>());

vi.mock("next/headers", () => ({
  cookies: async () => ({ has: (name: string) => jar.has(name) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new Error(`REDIRECT ${target}`);
  },
}));

import LoginPage from "@/app/login/page";

type PageProps = {
  messageKey: string | null;
  callbackUrl: string;
  devAuthAvailable: boolean;
  accountMissing: boolean;
};

async function render(params: Record<string, string> = {}): Promise<PageProps> {
  const element = (await LoginPage({ searchParams: Promise.resolve(params) })) as ReactElement;
  return element.props as PageProps;
}

/**
 * What /login decides: send the visitor on to the identity provider, or stop
 * and say why they are here. A screen that redirected after a refusal or a
 * sign-out would loop or sign them straight back in.
 */
describe("the login page", () => {
  const originalBypass = process.env.DEV_AUTH_BYPASS;

  beforeEach(async () => {
    jar.clear();
    process.env.DEV_AUTH_BYPASS = "false";
    await createTestUser(getTestDb(), "me@example.com");
  });

  afterEach(() => {
    if (originalBypass == null) delete process.env.DEV_AUTH_BYPASS;
    else process.env.DEV_AUTH_BYPASS = originalBypass;
  });

  it("sends a visitor on to the provider, remembering where they were headed", async () => {
    await expect(render({ callbackUrl: "/stats?x=1" })).rejects.toThrow(
      "REDIRECT /api/auth/login?callbackUrl=%2Fstats%3Fx%3D1"
    );
    await expect(render({ callbackUrl: "https://evil.example" })).rejects.toThrow(
      "REDIRECT /api/auth/login?callbackUrl=%2F"
    );
  });

  it.each(["not_bound", "denied", "failed"])(
    "stops at %s instead of redirecting again",
    async (error) => {
      await expect(render({ error })).resolves.toMatchObject({ messageKey: error });
    }
  );

  it.each(["signed_out", "credentials_changed"])("stops at the %s notice", async (notice) => {
    await expect(render({ notice })).resolves.toMatchObject({ messageKey: notice });
  });

  it("ignores a message it has no text for", async () => {
    await expect(render({ error: "<script>", notice: "nope" })).rejects.toThrow(/^REDIRECT /);
  });

  it("treats someone who left a moment ago as signed out, so a stray visit does not sign them back in", async () => {
    jar.add("cashier_signed_out");

    await expect(render()).resolves.toMatchObject({ messageKey: "signed_out" });
    await expect(render({ error: "denied" })).resolves.toMatchObject({ messageKey: "denied" });
  });

  it("offers the development entry instead of the provider when the bypass is on", async () => {
    process.env.DEV_AUTH_BYPASS = "true";

    await expect(render()).resolves.toMatchObject({ devAuthAvailable: true, messageKey: null });
  });

  it("explains how to create the account when there is none", async () => {
    const db = getTestDb();
    await db.delete(loginEmails);
    await db.delete(users);

    await expect(render()).resolves.toMatchObject({ accountMissing: true, messageKey: null });
  });
});
