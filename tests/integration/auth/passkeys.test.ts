import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { passkeys, users, webauthnChallenges } from "@/persistence";
import { SESSION_COOKIE_NAME } from "@/modules/auth/constants";
import { createSession } from "@/modules/auth/server/sessions";
import { startPasskeySignIn } from "@/modules/auth/server/passkeys";
import { createTestUserWithLedger } from "../../helpers/schema-setup";
import { TestAuthenticator } from "../../helpers/webauthn";

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
  deletePasskeyAction,
  finishPasskeyRegistrationAction,
  renamePasskeyAction,
  startPasskeyRegistrationAction,
} from "@/modules/auth/server-actions/passkeys";
import {
  finishPasskeySignInAction,
  startPasskeySignInAction,
} from "@/modules/auth/server-actions/sign-in";
import { getCurrentSession } from "@/modules/auth/server/current-session";
import { POST } from "@/app/api/ledger-queries/route";

const EMAIL = "owner@example.com";

async function signedIn(authenticatedAt = new Date()): Promise<string> {
  const { userId } = await createTestUserWithLedger(getTestDb(), EMAIL);
  const { token } = await createSession(userId, authenticatedAt);
  jar.set(SESSION_COOKIE_NAME, token);
  return userId;
}

async function register(authenticator: TestAuthenticator, name = "MacBook") {
  const started = await startPasskeyRegistrationAction();
  if (!started.ok) throw new Error(`registration did not start: ${started.code}`);
  return finishPasskeyRegistrationAction(
    started.challengeId,
    authenticator.register(started.options),
    name
  );
}

async function startSignIn() {
  const started = await startPasskeySignInAction();
  if (!started.ok) throw new Error(`sign-in did not start: ${started.code}`);
  return started;
}

/** The 设置 list, read through the registry the way the browser reads it. */
async function listedPasskeys(): Promise<unknown> {
  const response = await POST(
    new Request("http://localhost/api/ledger-queries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "passkeys", args: [] }),
    })
  );
  expect(response.status).toBe(200);
  return response.json();
}

describe("passkeys", () => {
  beforeEach(() => jar.clear());

  it("registers a passkey and then signs in with it", async () => {
    const userId = await signedIn();
    const authenticator = new TestAuthenticator();

    const registered = await register(authenticator);
    expect(registered).toMatchObject({
      ok: true,
      passkey: { id: authenticator.id, name: "MacBook" },
    });
    await expect(listedPasskeys()).resolves.toEqual([
      expect.objectContaining({ id: authenticator.id, name: "MacBook", lastUsedAt: null }),
    ]);

    jar.clear();
    const { challengeId, options } = await startSignIn();
    await expect(
      finishPasskeySignInAction(challengeId, authenticator.authenticate(options))
    ).resolves.toEqual({ ok: true });

    await expect(getCurrentSession()).resolves.toMatchObject({ userId, email: EMAIL });
    const [row] = await getTestDb().select().from(passkeys);
    expect(row).toMatchObject({ counter: 1 });
    expect(row!.lastUsedAt).not.toBeNull();
  });

  it("uses a challenge once", async () => {
    await signedIn();
    const authenticator = new TestAuthenticator();
    await register(authenticator);

    const { challengeId, options } = await startSignIn();
    await finishPasskeySignInAction(challengeId, authenticator.authenticate(options));
    jar.clear();

    await expect(
      finishPasskeySignInAction(challengeId, authenticator.authenticate(options))
    ).resolves.toEqual({ ok: false, code: "invalid_credentials" });
    expect(jar.has(SESSION_COOKIE_NAME)).toBe(false);
  });

  it("refuses an expired challenge", async () => {
    await signedIn();
    const authenticator = new TestAuthenticator();
    await register(authenticator);
    jar.clear();

    const { challengeId, options } = await startPasskeySignIn(
      "127.0.0.1",
      new Date(Date.now() - 6 * 60 * 1000)
    );

    await expect(
      finishPasskeySignInAction(challengeId, authenticator.authenticate(options))
    ).resolves.toEqual({ ok: false, code: "invalid_credentials" });
  });

  it("refuses a counter that did not move forward", async () => {
    await signedIn();
    const authenticator = new TestAuthenticator();
    await register(authenticator);

    const first = await startSignIn();
    await finishPasskeySignInAction(first.challengeId, authenticator.authenticate(first.options));
    jar.clear();

    const second = await startSignIn();
    await expect(
      finishPasskeySignInAction(
        second.challengeId,
        authenticator.authenticate(second.options, { counter: 1 })
      )
    ).resolves.toEqual({ ok: false, code: "invalid_credentials" });
    expect(jar.has(SESSION_COOKIE_NAME)).toBe(false);
  });

  it("refuses an assertion made for another origin", async () => {
    await signedIn();
    const authenticator = new TestAuthenticator();
    await register(authenticator);
    jar.clear();

    const { challengeId, options } = await startSignIn();
    await expect(
      finishPasskeySignInAction(
        challengeId,
        authenticator.authenticate(options, { origin: "https://evil.example" })
      )
    ).resolves.toEqual({ ok: false, code: "invalid_credentials" });
  });

  it("refuses a passkey the account does not have", async () => {
    await signedIn();
    jar.clear();
    const stranger = new TestAuthenticator();

    const { challengeId, options } = await startSignIn();
    await expect(
      finishPasskeySignInAction(challengeId, stranger.authenticate(options))
    ).resolves.toEqual({ ok: false, code: "invalid_credentials" });
  });

  it("asks for a recent sign-in before adding or deleting a passkey", async () => {
    await signedIn(new Date(Date.now() - 20 * 60 * 1000));

    await expect(startPasskeyRegistrationAction()).resolves.toEqual({
      ok: false,
      code: "reauth_required",
    });
    await expect(deletePasskeyAction("anything")).resolves.toEqual({
      ok: false,
      code: "reauth_required",
    });
  });

  it("renames and deletes a passkey, including the last one", async () => {
    await signedIn();
    const authenticator = new TestAuthenticator();
    await register(authenticator);

    await expect(renamePasskeyAction(authenticator.id, "  iPhone  ")).resolves.toEqual({
      ok: true,
    });
    await expect(listedPasskeys()).resolves.toEqual([expect.objectContaining({ name: "iPhone" })]);
    await expect(renamePasskeyAction(authenticator.id, "   ")).resolves.toEqual({
      ok: false,
      code: "invalid",
    });

    await expect(deletePasskeyAction(authenticator.id)).resolves.toEqual({ ok: true });
    await expect(listedPasskeys()).resolves.toEqual([]);
    await expect(deletePasskeyAction(authenticator.id)).resolves.toEqual({
      ok: false,
      code: "not_found",
    });
  });

  it("limits sign-in starts per IP address", async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) await startSignIn();

    await expect(startPasskeySignInAction()).resolves.toEqual({
      ok: false,
      code: "passkey_rate_limited",
    });
  });

  it("goes with the account, challenges included", async () => {
    const userId = await signedIn();
    await register(new TestAuthenticator());
    await startPasskeyRegistrationAction();

    await getTestDb().delete(users).where(eq(users.id, userId));

    expect(await getTestDb().select().from(passkeys)).toEqual([]);
    expect(
      await getTestDb()
        .select()
        .from(webauthnChallenges)
        .where(eq(webauthnChallenges.userId, userId))
    ).toEqual([]);
  });
});
