import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestUser } from "tests/helpers/schema-setup";
import { createSession, readSession } from "@/modules/auth/server/sessions";
import { findUserByEmail, findUserById, listLoginEmails } from "@/modules/auth/server/users";
import {
  createEmailChangeChallenge,
  removeLoginEmail,
  verifyEmailChangeChallenge,
} from "@/modules/auth/server/account-security";
import { loginEmails } from "@/persistence";
import { hashOTP } from "@/modules/auth/domain/otp";

/**
 * The one account and its login addresses. Every address signs in with a code
 * sent to it, and the account must keep at least one address.
 */
describe("login emails", () => {
  it("resolves the account from any of its addresses", async () => {
    const db = getTestDb();
    const userId = await createTestUser(db, "first@example.com");
    await db
      .insert(loginEmails)
      .values({ userId, email: "second@example.com", emailVerified: new Date() });

    const first = await findUserByEmail("first@example.com");
    const second = await findUserByEmail("second@example.com");
    expect(first?.id).toBe(userId);
    expect(second?.id).toBe(userId);
    // `email` is the caller's own address, so the account cannot be identified
    // by a stale "primary" one.
    expect(second?.email).toBe("second@example.com");
    expect(await findUserByEmail("nobody@example.com")).toBeNull();
  });

  it("reports the account's addresses oldest first and lists the first as its email", async () => {
    const db = getTestDb();
    const userId = await createTestUser(db, "first@example.com");
    await db
      .insert(loginEmails)
      .values({ userId, email: "second@example.com", emailVerified: new Date() });

    const addresses = await listLoginEmails(userId);
    expect(addresses.map((row) => row.email)).toEqual(["first@example.com", "second@example.com"]);
    expect((await findUserById(userId))?.email).toBe("first@example.com");
  });

  it("adds an address through a verified challenge", async () => {
    const db = getTestDb();
    const userId = await createTestUser(db, "owner@example.com");
    const otp = "123456";

    const created = await createEmailChangeChallenge({
      userId,
      newEmail: "added@example.com",
      tokenHash: hashOTP(otp),
      expiresAt: new Date(Date.now() + 60_000),
      now: new Date(),
      minimumIntervalMs: 0,
    });
    expect(created).toBe("created");

    const verified = await verifyEmailChangeChallenge({
      userId,
      newEmail: "added@example.com",
      otp,
      now: new Date(),
    });
    expect(verified).toEqual({ status: "verified", email: "added@example.com" });
    expect(await findUserByEmail("added@example.com")).toMatchObject({
      id: userId,
    });
  });

  it("keeps the failed attempts across a resent code", async () => {
    const db = getTestDb();
    const userId = await createTestUser(db, "owner@example.com");
    const issue = (otp: string) =>
      createEmailChangeChallenge({
        userId,
        newEmail: "added@example.com",
        tokenHash: hashOTP(otp),
        expiresAt: new Date(Date.now() + 60_000),
        now: new Date(),
        minimumIntervalMs: 0,
      });
    const guess = (otp: string) =>
      verifyEmailChangeChallenge({ userId, newEmail: "added@example.com", otp, now: new Date() });

    expect(await issue("123456")).toBe("created");
    expect(await guess("000000")).toMatchObject({ status: "incorrect", attemptsRemaining: 4 });
    expect(await guess("000001")).toMatchObject({ status: "incorrect", attemptsRemaining: 3 });

    expect(await issue("654321")).toBe("created");
    expect(await guess("000002")).toMatchObject({ status: "incorrect", attemptsRemaining: 2 });
  });

  it("refuses an address that another account already signs in with", async () => {
    const db = getTestDb();
    const userId = await createTestUser(db, "owner@example.com");
    await createTestUser(db, "taken@example.com", crypto.randomUUID());

    const created = await createEmailChangeChallenge({
      userId,
      newEmail: "taken@example.com",
      tokenHash: hashOTP("123456"),
      expiresAt: new Date(Date.now() + 60_000),
      now: new Date(),
      minimumIntervalMs: 0,
    });
    expect(created).toBe("duplicate");
  });

  it("removes an address and signs the account out for it, but never the last one", async () => {
    const db = getTestDb();
    const userId = await createTestUser(db, "first@example.com");
    await db
      .insert(loginEmails)
      .values({ userId, email: "second@example.com", emailVerified: new Date() });
    const { token } = await createSession(userId);

    const removed = await removeLoginEmail({
      userId,
      email: "second@example.com",
      now: new Date(),
    });
    expect(removed).toBe("removed");
    expect(await findUserByEmail("second@example.com")).toBeNull();
    // A session opened with the removed address must not survive the removal.
    expect(await readSession(token)).toBeNull();

    expect(
      await removeLoginEmail({
        userId,
        email: "first@example.com",
        now: new Date(),
      })
    ).toBe("last_email");
    expect(
      await db
        .select({ id: loginEmails.id })
        .from(loginEmails)
        .where(eq(loginEmails.userId, userId))
    ).toHaveLength(1);
  });
});
