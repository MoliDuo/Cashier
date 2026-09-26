import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { books, entryCategories, ledgers, loginEmails, users } from "@/persistence";
import { findUserByEmail } from "@/modules/auth/server/users";
import { createInitialAccount, hasAccount } from "@/modules/auth/server/initial-account";

/** What `account:create` writes: the whole initial state, once. */
describe("createInitialAccount", () => {
  beforeEach(async () => {
    // The shared fixture seeds an account; these start from an empty instance.
    const db = getTestDb();
    await db.delete(loginEmails);
    await db.delete(users);
  });

  it("creates the account, its verified address, the ledger, books and categories", async () => {
    const db = getTestDb();
    expect(await hasAccount()).toBe(false);

    const result = await createInitialAccount({
      bookNames: ["共同支出", "哞哞的"],
      email: "Owner@Example.com",
    });

    expect(await hasAccount()).toBe(true);
    expect(await findUserByEmail("owner@example.com")).toMatchObject({ id: result.userId });
    const [address] = await db.select().from(loginEmails);
    expect(address).toMatchObject({ email: "owner@example.com", userId: result.userId });
    expect(address?.emailVerified).toBeInstanceOf(Date);
    expect(await db.select({ id: ledgers.id }).from(ledgers)).toEqual([{ id: result.ledgerId }]);
    const ledgerBooks = await db.query.books.findMany({
      where: eq(books.ledgerId, result.ledgerId),
      orderBy: [books.sortOrder],
    });
    expect(ledgerBooks.map((book) => book.name)).toEqual(["共同支出", "哞哞的"]);
    const categories = await db.query.entryCategories.findMany({
      where: eq(entryCategories.ledgerId, result.ledgerId),
    });
    expect(categories.length).toBeGreaterThan(0);
  });

  it("refuses a second account", async () => {
    await createInitialAccount({ bookNames: ["共同支出"], email: "owner@example.com" });

    await expect(
      createInitialAccount({ bookNames: ["另一个"], email: "second@example.com" })
    ).rejects.toThrow(/account already exists/);
    expect(await getTestDb().select({ id: users.id }).from(users)).toHaveLength(1);
    expect(await getTestDb().select({ id: ledgers.id }).from(ledgers)).toHaveLength(1);
  });

  it("refuses an address that already signs in", async () => {
    await createInitialAccount({ bookNames: ["共同支出"], email: "owner@example.com" });

    await expect(
      createInitialAccount({ bookNames: ["共同支出"], email: "OWNER@example.com" })
    ).rejects.toThrow(/already signs in/);
  });

  it("refuses to add a second ledger beside one left without an account", async () => {
    await getTestDb().insert(ledgers).values({});

    await expect(
      createInitialAccount({ bookNames: ["共同支出"], email: "owner@example.com" })
    ).rejects.toThrow(/ledger already exists/);
    // The transaction rolled back: no account was left behind.
    expect(await hasAccount()).toBe(false);
  });

  it("writes nothing when a later step fails", async () => {
    await expect(
      createInitialAccount({ bookNames: ["共同支出", "共同支出"], email: "owner@example.com" })
    ).rejects.toThrow(/unique/);
    await expect(
      createInitialAccount({ bookNames: ["x".repeat(200)], email: "owner@example.com" })
    ).rejects.toThrow();

    expect(await hasAccount()).toBe(false);
    expect(await getTestDb().select({ id: ledgers.id }).from(ledgers)).toHaveLength(0);
    expect(await getTestDb().select({ id: loginEmails.id }).from(loginEmails)).toHaveLength(0);
  });
});
