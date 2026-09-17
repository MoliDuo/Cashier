import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { users } from "@/persistence/schema/auth";
import { AUTH_ERROR_CODES } from "@/modules/auth/errors";
import {
  assertMemberLoginAllowed,
  isMemberLoginAllowed,
  MemberLoginDisabledError,
} from "@/modules/auth/application/use-cases/member-login-policy";
import { serverComposition } from "@/application/server-composition-root";
import { configureTestCoupleLedger, TEST_USER_ID } from "tests/helpers/schema-setup";

describe("member login policy", () => {
  it("denies unknown users without creating an account", async () => {
    const usersPort = serverComposition.userAccounts;
    await expect(isMemberLoginAllowed("unknown@example.com", usersPort)).resolves.toBe(false);
    await expect(assertMemberLoginAllowed("unknown@example.com", usersPort)).rejects.toMatchObject({
      code: AUTH_ERROR_CODES.REGISTRATION_DISABLED,
    });
    await expect(assertMemberLoginAllowed("unknown@example.com", usersPort)).rejects.toBeInstanceOf(
      MemberLoginDisabledError
    );
    await expect(usersPort.findByEmail("unknown@example.com")).resolves.toBeNull();
  });

  it("allows only configured existing accounts after email changes", async () => {
    const db = getTestDb();
    await db.update(users).set({ email: "changed@example.com" }).where(eq(users.id, TEST_USER_ID));
    await configureTestCoupleLedger(db, crypto.randomUUID());
    await expect(
      assertMemberLoginAllowed("CHANGED@EXAMPLE.COM", serverComposition.userAccounts)
    ).resolves.toMatchObject({ id: TEST_USER_ID });
  });
});
