import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { emailChangeChallenges, otpTokens, users } from "@/persistence";
import { hashOTP } from "@/modules/auth/services/otp";

const userId = "00000000-0000-0000-0000-000000000000";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: {
      id: "00000000-0000-0000-0000-000000000000",
      email: "test@example.com",
      authenticatedAt: new Date().toISOString(),
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  }),
}));

vi.mock("resend", () => ({
  Resend: class MockResend {
    emails = { send: vi.fn().mockResolvedValue({ data: { id: "email-id" }, error: null }) };
  },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn(() => null) }),
  cookies: vi.fn().mockResolvedValue({ get: vi.fn(() => undefined) }),
}));

import {
  sendEmailChangeCodeAction,
  verifyEmailChangeCodeAction,
} from "@/modules/auth/server-actions/change-email";

describe("email change challenges", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores a dedicated challenge without creating a login OTP or user", async () => {
    await expect(sendEmailChangeCodeAction("New@Example.com", "en-US")).resolves.toMatchObject({
      ok: true,
    });
    const db = getTestDb();
    const challenge = await db.query.emailChangeChallenges.findFirst({
      where: eq(emailChangeChallenges.userId, userId),
    });
    expect(challenge?.newEmail).toBe("new@example.com");
    expect(
      await db.query.otpTokens.findFirst({ where: eq(otpTokens.email, "new@example.com") })
    ).toBeUndefined();
    expect(
      await db.query.users.findFirst({ where: eq(users.email, "new@example.com") })
    ).toBeUndefined();
  });

  it("updates the same user after successful verification", async () => {
    const db = getTestDb();
    await db.insert(emailChangeChallenges).values({
      userId,
      newEmail: "new@example.com",
      tokenHash: hashOTP("123456"),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(verifyEmailChangeCodeAction("new@example.com", "123456")).resolves.toEqual({
      ok: true,
      email: "new@example.com",
    });
    const updated = await db.query.users.findFirst({ where: eq(users.id, userId) });
    expect(updated?.email).toBe("new@example.com");
    expect(updated?.authVersion).toBe(2);
    expect(
      await db.query.emailChangeChallenges.findFirst({
        where: eq(emailChangeChallenges.userId, userId),
      })
    ).toBeUndefined();
  });

  it("persists incorrect attempts and rejects expired codes", async () => {
    const db = getTestDb();
    await db.insert(emailChangeChallenges).values({
      userId,
      newEmail: "new@example.com",
      tokenHash: hashOTP("123456"),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(verifyEmailChangeCodeAction("new@example.com", "000000")).resolves.toEqual({
      ok: false,
      code: "invalid_code",
    });
    const failed = await db.query.emailChangeChallenges.findFirst({
      where: eq(emailChangeChallenges.userId, userId),
    });
    expect(failed?.attempts).toBe(1);
    await db
      .update(emailChangeChallenges)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(emailChangeChallenges.userId, userId));
    await expect(verifyEmailChangeCodeAction("new@example.com", "123456")).resolves.toEqual({
      ok: false,
      code: "expired_code",
    });
  });

  it("does not reset a locked challenge when requesting another code", async () => {
    const db = getTestDb();
    await db.insert(emailChangeChallenges).values({
      userId,
      newEmail: "new@example.com",
      tokenHash: hashOTP("123456"),
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 5,
      lockedUntil: new Date(Date.now() + 60_000),
    });
    const before = await db.query.emailChangeChallenges.findFirst({
      where: eq(emailChangeChallenges.userId, userId),
    });

    await expect(sendEmailChangeCodeAction("new@example.com", "en-US")).resolves.toEqual({
      ok: false,
      code: "locked",
    });
    const after = await db.query.emailChangeChallenges.findFirst({
      where: eq(emailChangeChallenges.userId, userId),
    });
    expect(after?.attempts).toBe(5);
    expect(after?.tokenHash).toBe(before?.tokenHash);
    expect(after?.lockedUntil).toEqual(before?.lockedUntil);
  });

  it("checks target-email uniqueness again during verification", async () => {
    const db = getTestDb();
    await db.insert(users).values({
      id: crypto.randomUUID(),
      email: "taken@example.com",
      nickname: "B",
      gender: "female",
    });
    await db.insert(emailChangeChallenges).values({
      userId,
      newEmail: "taken@example.com",
      tokenHash: hashOTP("123456"),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(verifyEmailChangeCodeAction("taken@example.com", "123456")).resolves.toEqual({
      ok: false,
      code: "email_in_use",
    });
    const original = await db.query.users.findFirst({
      where: and(eq(users.id, userId), eq(users.email, "test@example.com")),
    });
    expect(original).toBeDefined();
  });

  it("does not lose concurrent failed verification attempts", async () => {
    const db = getTestDb();
    await db.insert(emailChangeChallenges).values({
      userId,
      newEmail: "new@example.com",
      tokenHash: hashOTP("123456"),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const attempts = await Promise.allSettled(
      Array.from({ length: 3 }, () => verifyEmailChangeCodeAction("new@example.com", "000000"))
    );
    expect(attempts.every((attempt) => attempt.status === "fulfilled")).toBe(true);
    expect(
      attempts.every(
        (attempt) =>
          attempt.status === "fulfilled" &&
          attempt.value.ok === false &&
          attempt.value.code === "invalid_code"
      )
    ).toBe(true);

    const challenge = await db.query.emailChangeChallenges.findFirst({
      where: eq(emailChangeChallenges.userId, userId),
    });
    expect(challenge?.attempts).toBe(3);
  });

  it("consumes a successful challenge only once under concurrency", async () => {
    const db = getTestDb();
    await db.insert(emailChangeChallenges).values({
      userId,
      newEmail: "new@example.com",
      tokenHash: hashOTP("123456"),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const outcomes = await Promise.allSettled([
      verifyEmailChangeCodeAction("new@example.com", "123456"),
      verifyEmailChangeCodeAction("new@example.com", "123456"),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled" && outcome.value.ok === true)
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled" && outcome.value.ok === false)
    ).toHaveLength(1);
    expect(
      await db.query.emailChangeChallenges.findFirst({
        where: eq(emailChangeChallenges.userId, userId),
      })
    ).toBeUndefined();
    expect(
      await db.query.users.findFirst({
        where: and(eq(users.id, userId), eq(users.email, "new@example.com")),
      })
    ).toBeDefined();
  });
});
