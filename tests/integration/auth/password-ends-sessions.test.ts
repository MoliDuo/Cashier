import { describe, expect, it } from "vitest";
import { getTestDb } from "tests/setup";
import { loginEmails, users } from "@/persistence";
import { setPassword } from "@/modules/auth/server/set-password";
import { changePassword } from "@/modules/auth/server/change-password";
import { createSession, readSession } from "@/modules/auth/server/sessions";

describe("password changes", () => {
  it("end every session of the account on each successful update", async () => {
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

    const first = await createSession(userId);
    await setPassword({
      userId,
      newPassword: "initial-password-1",
      confirmPassword: "initial-password-1",
    });
    expect(await readSession(first.token)).toBeNull();

    const second = await createSession(userId);
    await changePassword({
      userId,
      currentPassword: "initial-password-1",
      newPassword: "changed-password-2",
      confirmPassword: "changed-password-2",
    });
    expect(await readSession(second.token)).toBeNull();
  });
});
