import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { passkeys, webauthnChallenges } from "@/persistence";
import { keyedDigest } from "@/lib/security/keys";
import { AUTH_PASSKEY_IP_MAX_ATTEMPTS } from "@/config/tuning";
import { SESSION_COOKIE_NAME } from "@/modules/auth/constants";
import {
  ENROLLMENT_TTL_MS,
  finishEnrollment,
  findEnrollmentUser,
  issueEnrollmentToken,
  startEnrollment,
} from "@/modules/auth/server/enrollment";
import { createTestUserWithLedger } from "tests/helpers/schema-setup";
import { TestAuthenticator } from "tests/helpers/webauthn";

const jar = vi.hoisted(() => new Map<string, string>());

// The shared setup stands in a session; enrollment signs in for real.
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
  finishEnrollmentAction,
  startEnrollmentAction,
} from "@/modules/auth/server-actions/enroll";
import { getCurrentSession } from "@/modules/auth/server/current-session";

const EMAIL = "owner@example.com";

async function issued(now?: Date) {
  const { userId } = await createTestUserWithLedger(getTestDb(), EMAIL);
  const result = await issueEnrollmentToken(EMAIL, now);
  if (result == null) throw new Error("expected a token for the account");
  return { userId, token: result.token };
}

async function enroll(token: string, authenticator: TestAuthenticator) {
  const started = await startEnrollmentAction(token);
  if (!started.ok) throw new Error(`enrollment did not start: ${started.code}`);
  return finishEnrollmentAction(
    token,
    started.challengeId,
    authenticator.register(started.options),
    "我的设备"
  );
}

async function enrollmentRows() {
  return getTestDb()
    .select()
    .from(webauthnChallenges)
    .where(eq(webauthnChallenges.purpose, "enroll"));
}

describe("enrollment tokens", () => {
  beforeEach(() => jar.clear());

  it("stores only a keyed digest of the token, for the account's user, for 30 minutes", async () => {
    const now = new Date();
    const { userId, token } = await issued(now);

    expect(token).toMatch(/^[\w-]{43}$/);
    const rows = await enrollmentRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId,
      challenge: keyedDigest("enrollment", token),
      expiresAt: new Date(now.getTime() + ENROLLMENT_TTL_MS),
    });
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(await findEnrollmentUser(token)).toBe(userId);
  });

  it("issues nothing for an address no account signs in with", async () => {
    await expect(issueEnrollmentToken("nobody@example.com")).resolves.toBeNull();
    expect(await enrollmentRows()).toHaveLength(0);
  });

  it("replaces a link issued before", async () => {
    const { token: first } = await issued();
    const second = await issueEnrollmentToken(EMAIL);

    expect(await findEnrollmentUser(first)).toBeNull();
    expect(await findEnrollmentUser(second!.token)).not.toBeNull();
    expect(await enrollmentRows()).toHaveLength(1);
  });

  it("refuses an expired link", async () => {
    const { token } = await issued(new Date(Date.now() - ENROLLMENT_TTL_MS - 1_000));

    expect(await findEnrollmentUser(token)).toBeNull();
    await expect(startEnrollmentAction(token)).resolves.toEqual({
      ok: false,
      code: "invalid_link",
    });
  });

  it("refuses a token that was never issued, and a malformed one", async () => {
    await issued();

    await expect(
      startEnrollmentAction(crypto.randomBytes(32).toString("base64url"))
    ).resolves.toEqual({ ok: false, code: "invalid_link" });
    await expect(startEnrollmentAction("not a token")).resolves.toEqual({
      ok: false,
      code: "invalid_link",
    });
  });
});

describe("enrolling a passkey", () => {
  beforeEach(() => jar.clear());

  it("stores the passkey, spends the link, and signs the browser in", async () => {
    const { userId, token } = await issued();
    const authenticator = new TestAuthenticator();

    await expect(enroll(token, authenticator)).resolves.toEqual({ ok: true });

    expect(await getTestDb().select().from(passkeys)).toEqual([
      expect.objectContaining({ id: authenticator.id, userId, name: "我的设备" }),
    ]);
    expect(await enrollmentRows()).toHaveLength(0);
    expect(jar.has(SESSION_COOKIE_NAME)).toBe(true);
    await expect(getCurrentSession()).resolves.toMatchObject({ userId, email: EMAIL });
  });

  it("uses a link once", async () => {
    const { token } = await issued();
    const started = await startEnrollmentAction(token);
    if (!started.ok) throw new Error(`enrollment did not start: ${started.code}`);
    await enroll(token, new TestAuthenticator());
    jar.clear();

    // Neither a fresh start nor a finish of a ceremony begun before it was spent.
    await expect(startEnrollmentAction(token)).resolves.toEqual({
      ok: false,
      code: "invalid_link",
    });
    await expect(
      finishEnrollmentAction(
        token,
        started.challengeId,
        new TestAuthenticator().register(started.options),
        "我的设备"
      )
    ).resolves.toEqual({ ok: false, code: "invalid_link" });
    expect(await getTestDb().select().from(passkeys)).toHaveLength(1);
    expect(jar.has(SESSION_COOKIE_NAME)).toBe(false);
  });

  it("lets exactly one of two racing finishes spend the link", async () => {
    const { token, userId } = await issued();
    const first = await startEnrollment(token, "127.0.0.1");
    const second = await startEnrollment(token, "127.0.0.1");
    if (first == null || second == null) throw new Error("enrollment did not start");

    const results = await Promise.all(
      [first, second].map((started) =>
        finishEnrollment({
          token,
          challengeId: started.challengeId,
          response: new TestAuthenticator().register(started.options),
          name: "我的设备",
        })
      )
    );

    expect(results).toEqual(
      expect.arrayContaining([
        { ok: true, userId },
        { ok: false, reason: "invalid_link" },
      ])
    );
    expect(await getTestDb().select().from(passkeys)).toHaveLength(1);
  });

  it("keeps the link after a ceremony that does not verify", async () => {
    const { token } = await issued();
    const forged = new TestAuthenticator("localhost", "https://evil.example");

    await expect(enroll(token, forged)).resolves.toEqual({ ok: false, code: "invalid" });
    expect(await getTestDb().select().from(passkeys)).toHaveLength(0);
    expect(jar.has(SESSION_COOKIE_NAME)).toBe(false);

    await expect(enroll(token, new TestAuthenticator())).resolves.toEqual({ ok: true });
  });

  it("counts starts per address", async () => {
    const { token } = await issued();
    for (let attempt = 0; attempt < AUTH_PASSKEY_IP_MAX_ATTEMPTS; attempt += 1) {
      expect((await startEnrollmentAction(token)).ok).toBe(true);
    }

    await expect(startEnrollmentAction(token)).resolves.toEqual({
      ok: false,
      code: "rate_limited",
    });
  });

  it("refuses a registration challenge it did not issue", async () => {
    const { token } = await issued();
    const started = await startEnrollmentAction(token);
    if (!started.ok) throw new Error(`enrollment did not start: ${started.code}`);

    await expect(
      finishEnrollmentAction(
        token,
        crypto.randomUUID(),
        new TestAuthenticator().register(started.options),
        "我的设备"
      )
    ).resolves.toEqual({ ok: false, code: "expired" });
    expect(await enrollmentRows()).toHaveLength(1);
  });
});
