import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getSessionUser as getSessionUserUseCase } from "@/modules/auth/application/queries/get-session-user";
import { serverComposition } from "@/application/server-composition-root";
import { getTestDb } from "tests/setup";
import { users } from "@/persistence/schema/auth";
import { UnauthorizedError } from "@/lib/errors";

const getSessionUser = (userId: string) =>
  getSessionUserUseCase(userId, serverComposition.userAccounts);

describe("getSessionUser", () => {
  it("returns selected session fields for an active user", async () => {
    const db = getTestDb();
    const userId = crypto.randomUUID();

    await db.insert(users).values({
      id: userId,
      email: "session-active@example.com",
      name: "Session Active",
      image: "https://example.com/avatar.png",
      passwordHash: null,
      passwordUpdatedAt: null,
      emailVerified: new Date(),
    });

    const result = await getSessionUser(userId);
    expect(result).toEqual({
      id: userId,
      email: "session-active@example.com",
      name: "Session Active",
      image: "https://example.com/avatar.png",
      passwordHash: null,
      passwordUpdatedAt: null,
      authVersion: 1,
      interfaceLanguage: "auto",
    });
  });

  it("rejects when user is soft deleted", async () => {
    const db = getTestDb();
    const userId = crypto.randomUUID();

    await db.insert(users).values({
      id: userId,
      email: "session-deleted@example.com",
      name: "Session Deleted",
      emailVerified: new Date(),
      deletedAt: new Date(),
    });

    await expect(getSessionUser(userId)).rejects.toThrow(UnauthorizedError);
    await expect(getSessionUser(userId)).rejects.toThrow("User not found in database");
  });

  it("rejects when user does not exist", async () => {
    const db = getTestDb();
    const userId = crypto.randomUUID();

    const existing = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    expect(existing).toBeUndefined();

    await expect(getSessionUser(userId)).rejects.toThrow(UnauthorizedError);
  });
});
