import { describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { createTestUser } from "../../helpers/schema-setup";
import { postgresUserAccountAdapter } from "@/application/adapters/postgres/business-ports/users";
import { postgresAccountSecurityAdapter } from "@/application/adapters/postgres/account-security";
import { books, entryCategories, ledgers, loginEmails, setupState, users } from "@/persistence";
import { createInitialAccount } from "@/modules/setup/application/create-initial-account";
import { postgresSetupAdapter } from "@/application/adapters/postgres/business-ports/setup";
import { hashOTP } from "@/modules/auth/services/otp";

/**
 * The one account and its login addresses. Every address signs in; the password
 * belongs to the account rather than to an address, and the account must keep at
 * least one address.
 */
describe("login emails", () => {
  it("resolves the account from any of its addresses", async () => {
    const db = getTestDb();
    const userId = await createTestUser(db, "first@example.com");
    await db
      .insert(loginEmails)
      .values({ userId, email: "second@example.com", emailVerified: new Date() });

    const first = await postgresUserAccountAdapter.findByEmail("first@example.com");
    const second = await postgresUserAccountAdapter.findByEmail("second@example.com");
    expect(first?.id).toBe(userId);
    expect(second?.id).toBe(userId);
    // `email` is the caller's own address, so the account cannot be identified
    // by a stale "primary" one.
    expect(second?.email).toBe("second@example.com");
    expect(await postgresUserAccountAdapter.findByEmail("nobody@example.com")).toBeNull();
  });

  it("reports the account's addresses oldest first and lists the first as its email", async () => {
    const db = getTestDb();
    const userId = await createTestUser(db, "first@example.com");
    await db
      .insert(loginEmails)
      .values({ userId, email: "second@example.com", emailVerified: new Date() });

    const addresses = await postgresUserAccountAdapter.listLoginEmails(userId);
    expect(addresses.map((row) => row.email)).toEqual(["first@example.com", "second@example.com"]);
    expect((await postgresUserAccountAdapter.findById(userId))?.email).toBe("first@example.com");
  });

  it("adds an address through a verified challenge", async () => {
    const db = getTestDb();
    const userId = await createTestUser(db, "owner@example.com");
    const otp = "123456";

    const created = await postgresAccountSecurityAdapter.createEmailChangeChallenge({
      userId,
      newEmail: "added@example.com",
      tokenHash: hashOTP(otp),
      expiresAt: new Date(Date.now() + 60_000),
      now: new Date(),
      minimumIntervalMs: 0,
    });
    expect(created).toBe("created");

    const verified = await postgresAccountSecurityAdapter.verifyEmailChangeChallenge({
      userId,
      newEmail: "added@example.com",
      otp,
      now: new Date(),
    });
    expect(verified).toEqual({ status: "verified", email: "added@example.com" });
    expect(await postgresUserAccountAdapter.findByEmail("added@example.com")).toMatchObject({
      id: userId,
    });
  });

  it("refuses an address that another account already signs in with", async () => {
    const db = getTestDb();
    const userId = await createTestUser(db, "owner@example.com");
    await createTestUser(db, "taken@example.com", crypto.randomUUID());

    const created = await postgresAccountSecurityAdapter.createEmailChangeChallenge({
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
    const before = (await db.query.users.findFirst({ where: eq(users.id, userId) }))!.authVersion;

    const removed = await postgresAccountSecurityAdapter.removeLoginEmail({
      userId,
      email: "second@example.com",
      now: new Date(),
    });
    expect(removed).toBe("removed");
    expect(await postgresUserAccountAdapter.findByEmail("second@example.com")).toBeNull();
    // A session opened with the removed address must not survive the removal.
    const after = (await db.query.users.findFirst({ where: eq(users.id, userId) }))!.authVersion;
    expect(after).toBe(before + 1);

    expect(
      await postgresAccountSecurityAdapter.removeLoginEmail({
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

/**
 * First-run setup: the only write path without a session. It creates the whole
 * initial state in one transaction, and refuses to run twice.
 */
describe("first-run setup", () => {
  it("reports pending on an empty database and creates everything at once", async () => {
    // The shared fixture seeds an account, so start from a clean slate.
    const db = getTestDb();
    await db.delete(loginEmails);
    await db.delete(users);
    expect(await postgresSetupAdapter.isPending()).toBe(true);

    const result = await createInitialAccount(
      {
        bookNames: ["共同支出", "哞哞的"],
        defaultBookName: "共同支出",
        email: "Owner@Example.com",
        password: "setup-pass-1",
        locale: "zh",
      },
      postgresSetupAdapter
    );

    expect(await postgresSetupAdapter.isPending()).toBe(false);
    expect(await postgresUserAccountAdapter.findByEmail("owner@example.com")).toMatchObject({
      id: result.userId,
    });
    const ledger = await db.query.ledgers.findFirst({
      where: and(eq(ledgers.id, result.ledgerId), isNull(ledgers.deletedAt)),
    });
    expect(ledger).toBeDefined();
    const ledgerBooks = await db.query.books.findMany({
      where: eq(books.ledgerId, result.ledgerId),
      orderBy: [books.sortOrder],
    });
    expect(ledgerBooks.map((book) => [book.name, book.isDefault])).toEqual([
      ["共同支出", true],
      ["哞哞的", false],
    ]);
    const categories = await db.query.entryCategories.findMany({
      where: eq(entryCategories.ledgerId, result.ledgerId),
    });
    expect(categories.length).toBeGreaterThan(0);

    // A second run must not create a second account or ledger.
    await expect(
      createInitialAccount(
        {
          bookNames: ["另一个"],
          defaultBookName: "另一个",
          email: "second@example.com",
          password: "setup-pass-2",
          locale: "zh",
        },
        postgresSetupAdapter
      )
    ).rejects.toThrow(/already been completed/);
  });

  it("stores one setup code, prints it once, and only accepts that code", async () => {
    const db = getTestDb();
    await db.delete(loginEmails);
    await db.delete(users);

    const first = await postgresSetupAdapter.getOrCreateCode();
    expect(first.created).toBe(true);
    expect(first.code).toMatch(/^\d{8}$/);

    // The plaintext exists only in the caller that created it: a later read
    // knows a code is pending but cannot reproduce it, so the wizard must not
    // print a second banner with a code that no longer matches.
    const second = await postgresSetupAdapter.getOrCreateCode();
    expect(second).toEqual({ code: "", created: false });

    expect(await postgresSetupAdapter.verifyCode(first.code)).toBe(true);
    expect(await postgresSetupAdapter.verifyCode("00000000")).toBe(false);
    expect(await postgresSetupAdapter.verifyCode("")).toBe(false);
    // A stored hash is not the code, and the row is not a second row.
    const rows = await db.select().from(setupState);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.codeHash).not.toContain(first.code);
  });

  it("clears the pending code once the account exists", async () => {
    const db = getTestDb();
    await db.delete(loginEmails);
    await db.delete(users);
    const { code } = await postgresSetupAdapter.getOrCreateCode();

    await createInitialAccount(
      {
        bookNames: ["共同支出"],
        defaultBookName: "共同支出",
        email: "owner@example.com",
        password: "setup-pass-1",
        locale: "zh",
      },
      postgresSetupAdapter
    );

    expect(await db.select().from(setupState)).toHaveLength(0);
    // A retired code cannot be replayed against a later, empty database either.
    expect(await postgresSetupAdapter.verifyCode(code)).toBe(false);
  });

  it("rejects a default book that is not one of the books", async () => {
    const db = getTestDb();
    await db.delete(loginEmails);
    await db.delete(users);

    await expect(
      createInitialAccount(
        {
          bookNames: ["共同支出"],
          defaultBookName: "别的",
          email: "owner@example.com",
          password: "setup-pass-1",
          locale: "zh",
        },
        postgresSetupAdapter
      )
    ).rejects.toThrow(/default book must be one of the books/);
  });

  it("rejects duplicate book names and a password that does not meet the policy", async () => {
    const db = getTestDb();
    await db.delete(loginEmails);
    await db.delete(users);

    await expect(
      createInitialAccount(
        {
          bookNames: ["共同支出", "共同支出"],
          defaultBookName: "共同支出",
          email: "owner@example.com",
          password: "setup-pass-1",
          locale: "zh",
        },
        postgresSetupAdapter
      )
    ).rejects.toThrow(/unique/);

    await expect(
      createInitialAccount(
        {
          bookNames: ["共同支出"],
          defaultBookName: "共同支出",
          email: "owner@example.com",
          password: "short",
          locale: "zh",
        },
        postgresSetupAdapter
      )
    ).rejects.toThrow(/8 and 128/);
  });
});
