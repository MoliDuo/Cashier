import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { loginEmails, users } from "@/persistence";
import { setPassword } from "@/modules/auth/server/set-password";
import { changePassword } from "@/modules/auth/server/change-password";

describe("password auth version", () => {
  it("increments authVersion in each successful credential update", async () => {
    const db = getTestDb();
    const userId = crypto.randomUUID();
    await db.insert(users).values({
      id: userId,
    });
    await db.insert(loginEmails).values({
      userId: userId,
      email: `password-${userId}@example.com`,
      emailVerified: new Date(),
    });

    await setPassword({
      userId,
      newPassword: "initial-password-1",
      confirmPassword: "initial-password-1",
    });
    expect(
      await db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { authVersion: true },
      })
    ).toEqual({ authVersion: 2 });

    await changePassword({
      userId,
      currentPassword: "initial-password-1",
      newPassword: "changed-password-2",
      confirmPassword: "changed-password-2",
    });
    expect(
      await db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { authVersion: true },
      })
    ).toEqual({ authVersion: 3 });
  });
});
