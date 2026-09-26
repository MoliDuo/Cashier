import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb, getTestPool } from "tests/setup";
import { sessions, users } from "@/persistence";
import {
  createSession,
  deleteSession,
  deleteUserSessions,
  readSession,
} from "@/modules/auth/server/sessions";
import { createTestUserWithLedger } from "tests/helpers/schema-setup";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("sessions", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads a new session back with its account", async () => {
    const { userId } = await createTestUserWithLedger(getTestDb(), "owner@example.com");
    const now = new Date("2026-09-01T00:00:00.000Z");

    const { token, expiresAt } = await createSession(userId, now);
    const session = await readSession(token, now);

    expect(session).toMatchObject({
      userId,
      email: "owner@example.com",
      authenticatedAt: now,
      expiresAt,
    });
    expect(expiresAt.getTime() - now.getTime()).toBe(14 * DAY_MS);
  });

  it("stores only a digest of the token", async () => {
    const { userId } = await createTestUserWithLedger(getTestDb());
    const { token } = await createSession(userId);

    const rows = await getTestDb().select().from(sessions).where(eq(sessions.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toContain(token);
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reads the session and its account in a single query", async () => {
    const { userId } = await createTestUserWithLedger(getTestDb());
    const { token } = await createSession(userId);
    const query = vi.spyOn(getTestPool(), "query");

    await readSession(token);

    expect(query).toHaveBeenCalledTimes(1);
  });

  it("extends a session seen over a day ago, and only then", async () => {
    const { userId } = await createTestUserWithLedger(getTestDb());
    const start = new Date("2026-09-01T00:00:00.000Z");
    const { token, expiresAt } = await createSession(userId, start);

    const sameDay = await readSession(token, new Date(start.getTime() + DAY_MS - 1));
    expect(sameDay?.expiresAt).toEqual(expiresAt);

    const nextDay = new Date(start.getTime() + DAY_MS);
    const renewed = await readSession(token, nextDay);
    expect(renewed?.expiresAt).toEqual(new Date(nextDay.getTime() + 14 * DAY_MS));
    // Renewal moves the expiry, never the time the user signed in.
    expect(renewed?.authenticatedAt).toEqual(start);
  });

  it("does not read an expired session", async () => {
    const { userId } = await createTestUserWithLedger(getTestDb());
    const start = new Date("2026-09-01T00:00:00.000Z");
    const { token, expiresAt } = await createSession(userId, start);

    expect(await readSession(token, expiresAt)).toBeNull();
  });

  it("does not read an unknown token", async () => {
    expect(await readSession("not-a-session")).toBeNull();
  });

  it("ends one session, or every session of the account", async () => {
    const { userId } = await createTestUserWithLedger(getTestDb());
    const first = await createSession(userId);
    const second = await createSession(userId);
    const third = await createSession(userId);

    await deleteSession(first.token);
    expect(await readSession(first.token)).toBeNull();
    expect(await readSession(second.token)).not.toBeNull();

    await deleteUserSessions(userId);
    expect(await readSession(second.token)).toBeNull();
    expect(await readSession(third.token)).toBeNull();
  });

  it("goes with the account", async () => {
    const { userId } = await createTestUserWithLedger(getTestDb());
    await createSession(userId);

    await getTestDb().delete(users).where(eq(users.id, userId));

    expect(await getTestDb().select().from(sessions)).toEqual([]);
  });
});
