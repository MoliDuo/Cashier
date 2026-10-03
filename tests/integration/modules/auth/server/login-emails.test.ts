import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestUser } from "tests/helpers/schema-setup";
import { createSession, readSession } from "@/modules/auth/server/sessions";
import { findUserByEmail, findUserById, listLoginEmails } from "@/modules/auth/server/users";
import {
  addLoginEmail,
  addLoginEmailToTheAccount,
  removeLoginEmail,
} from "@/modules/auth/server/login-emails";
import { ConflictError } from "@/lib/errors";
import { loginEmails } from "@/persistence";

/**
 * The one account and its login addresses. The identity provider vouches for an
 * address, so binding one needs no code; the account must keep at least one.
 */
describe("login emails", () => {
  it("resolves the account from any of its addresses, whatever the case", async () => {
    const db = getTestDb();
    const userId = await createTestUser(db, "first@example.com");
    await db.insert(loginEmails).values({ userId, email: "second@example.com" });

    const first = await findUserByEmail("first@example.com");
    const second = await findUserByEmail("Second@Example.com");
    expect(first?.id).toBe(userId);
    expect(second?.id).toBe(userId);
    expect(await findUserByEmail("nobody@example.com")).toBeNull();
  });

  it("reports the account's addresses oldest first and lists the first as its email", async () => {
    const db = getTestDb();
    const userId = await createTestUser(db, "first@example.com");
    await db.insert(loginEmails).values({ userId, email: "second@example.com" });

    const addresses = await listLoginEmails(userId);
    expect(addresses.map((row) => row.email)).toEqual(["first@example.com", "second@example.com"]);
    expect((await findUserById(userId))?.email).toBe("first@example.com");
  });

  it("binds an address, which can then sign in", async () => {
    const db = getTestDb();
    const userId = await createTestUser(db, "owner@example.com");

    await addLoginEmail({ userId, email: "added@example.com" });

    expect(await findUserByEmail("added@example.com")).toMatchObject({ id: userId });
  });

  it("refuses an address that is already bound, in any case, to this or another account", async () => {
    const db = getTestDb();
    const userId = await createTestUser(db, "owner@example.com");
    await createTestUser(db, "taken@example.com", crypto.randomUUID());

    await expect(addLoginEmail({ userId, email: "taken@example.com" })).rejects.toThrow(
      ConflictError
    );
    await expect(addLoginEmail({ userId, email: "OWNER@example.com" })).rejects.toThrow(
      ConflictError
    );
    expect(await listLoginEmails(userId)).toHaveLength(1);
  });

  it("binds an address to the one account from the command line", async () => {
    const db = getTestDb();
    const userId = await createTestUser(db, "owner@example.com");

    await addLoginEmailToTheAccount("new-name@example.com");

    expect(await findUserByEmail("new-name@example.com")).toMatchObject({ id: userId });
  });

  it("removes an address and signs the account out for it, but never the last one", async () => {
    const db = getTestDb();
    const userId = await createTestUser(db, "first@example.com");
    await db.insert(loginEmails).values({ userId, email: "second@example.com" });
    const { token } = await createSession(userId);

    const removed = await removeLoginEmail({
      userId,
      email: "second@example.com",
      now: new Date(),
    });
    expect(removed).toBe("removed");
    expect(await findUserByEmail("second@example.com")).toBeNull();
    // A session does not remember which address opened it, so none may survive.
    expect(await readSession(token)).toBeNull();

    expect(await removeLoginEmail({ userId, email: "first@example.com", now: new Date() })).toBe(
      "last_email"
    );
    expect(
      await db
        .select({ id: loginEmails.id })
        .from(loginEmails)
        .where(eq(loginEmails.userId, userId))
    ).toHaveLength(1);
  });

  it("reports an address the account does not have", async () => {
    const db = getTestDb();
    const userId = await createTestUser(db, "first@example.com");
    await db.insert(loginEmails).values({ userId, email: "second@example.com" });

    expect(await removeLoginEmail({ userId, email: "other@example.com", now: new Date() })).toBe(
      "not_found"
    );
  });
});
