import { describe, expect, it, vi } from "vitest";
// The setup action reads the request headers to pick a locale. There is no
// request in a unit-run integration test, so the boundary is stood in for.
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "accept-language": "zh-CN" })),
}));
import { eq, sql } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { createTestUser } from "../../helpers/schema-setup";
import { createSession, readSession } from "@/modules/auth/server/sessions";
import { findUserByEmail, findUserById, listLoginEmails } from "@/modules/auth/server/users";
import {
  createEmailChangeChallenge,
  removeLoginEmail,
  verifyEmailChangeChallenge,
} from "@/modules/auth/server/account-security";
import { books, entryCategories, ledgers, loginEmails, setupState, users } from "@/persistence";
import { createInitialAccount, isSetupPending } from "@/modules/setup/server/initial-account";
import { completeSetupAction } from "@/modules/setup/server-actions/setup";
import {
  getOrCreateSetupCode,
  SETUP_CODE_MAX_ATTEMPTS,
  SETUP_CODE_TTL_MS,
  verifySetupCode,
} from "@/modules/setup/server/setup-code";
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
    expect(await isSetupPending()).toBe(true);

    const result = await createInitialAccount({
      bookNames: ["共同支出", "哞哞的"],
      email: "Owner@Example.com",
    });

    expect(await isSetupPending()).toBe(false);
    expect(await findUserByEmail("owner@example.com")).toMatchObject({
      id: result.userId,
    });
    const ledger = await db.query.ledgers.findFirst({
      where: eq(ledgers.id, result.ledgerId),
    });
    expect(ledger).toBeDefined();
    const ledgerBooks = await db.query.books.findMany({
      where: eq(books.ledgerId, result.ledgerId),
      orderBy: [books.sortOrder],
    });
    expect(ledgerBooks.map((book) => book.name)).toEqual(["共同支出", "哞哞的"]);
    const categories = await db.query.entryCategories.findMany({
      where: eq(entryCategories.ledgerId, result.ledgerId),
    });
    expect(categories.length).toBeGreaterThan(0);

    // A second run must not create a second account or ledger.
    await expect(
      createInitialAccount({
        bookNames: ["另一个"],
        email: "second@example.com",
      })
    ).rejects.toThrow(/already been completed/);
  });

  it("stores one setup code, prints it once, and only accepts that code", async () => {
    const db = getTestDb();
    await db.delete(loginEmails);
    await db.delete(users);

    const first = await getOrCreateSetupCode();
    expect(first.created).toBe(true);
    expect(first.code).toMatch(/^\d{8}$/);

    // The plaintext exists only in the caller that created it: a later read
    // knows a code is pending but cannot reproduce it, so the wizard must not
    // print a second banner with a code that no longer matches.
    const second = await getOrCreateSetupCode();
    expect(second.created).toBe(false);
    expect(second.code).toBe("");
    expect(second.issuedAt).toEqual(first.issuedAt);

    expect(await verifySetupCode(first.code)).toBe("accepted");
    expect(await verifySetupCode("00000000")).toBe("mismatch");
    expect(await verifySetupCode("")).toBe("mismatch");
    // A stored hash is not the code, and the row is not a second row.
    const rows = await db.select().from(setupState);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.codeHash).not.toContain(first.code);
  });

  it("issues a fresh code once the printed one has expired", async () => {
    const db = getTestDb();
    await db.delete(loginEmails);
    await db.delete(users);

    const first = await getOrCreateSetupCode();
    expect(first.created).toBe(true);

    // Age the stored code past its lifetime. A code nobody read out of the logs
    // must not refuse the wizard forever, so the next visit replaces it.
    await db
      .update(setupState)
      .set({ createdAt: new Date(Date.now() - SETUP_CODE_TTL_MS - 1_000) });

    expect(await verifySetupCode(first.code)).toBe("expired");

    const second = await getOrCreateSetupCode();
    expect(second.created).toBe(true);
    expect(second.code).toMatch(/^\d{8}$/);
    expect(second.code).not.toBe(first.code);
    // The replacement is what the wizard accepts, and the old code is dead.
    expect(await verifySetupCode(second.code)).toBe("accepted");
    expect(await verifySetupCode(first.code)).toBe("mismatch");
  });

  it("retires the code after five wrong guesses and issues a new one", async () => {
    const db = getTestDb();
    await db.delete(loginEmails);
    await db.delete(users);

    const { code } = await getOrCreateSetupCode();
    // Eight digits is not much of a secret; the attempt counter is what makes
    // guessing impractical.
    for (let attempt = 1; attempt < SETUP_CODE_MAX_ATTEMPTS; attempt += 1) {
      expect(await verifySetupCode("00000000")).toBe("mismatch");
      const rows = await db.select().from(setupState);
      expect(rows[0]?.failedAttempts).toBe(attempt);
    }

    expect(await verifySetupCode("00000000")).toBe("locked_out");
    // The row is gone, so the operator's correct code is retired with it: the
    // wizard must print a new one rather than leave a code that cannot work.
    expect(await db.select().from(setupState)).toHaveLength(0);
    expect(await verifySetupCode(code)).toBe("expired");

    const replacement = await getOrCreateSetupCode();
    expect(replacement.created).toBe(true);
    // The counter belongs to the retired code, not to the instance.
    expect(await verifySetupCode(replacement.code)).toBe("accepted");
  });

  it("clears the pending code once the account exists", async () => {
    const db = getTestDb();
    await db.delete(loginEmails);
    await db.delete(users);
    const { code } = await getOrCreateSetupCode();

    await createInitialAccount({
      bookNames: ["共同支出"],
      email: "owner@example.com",
    });

    expect(await db.select().from(setupState)).toHaveLength(0);
    // A retired code cannot be replayed against a later, empty database either.
    expect(await verifySetupCode(code)).toBe("expired");
  });

  it("rejects duplicate book names", async () => {
    const db = getTestDb();
    await db.delete(loginEmails);
    await db.delete(users);

    await expect(
      createInitialAccount({
        bookNames: ["共同支出", "共同支出"],
        email: "owner@example.com",
      })
    ).rejects.toThrow(/unique/);
    expect(await isSetupPending()).toBe(true);
  });

  it("creates the account with no password: it signs in with a code, then a passkey", async () => {
    const db = getTestDb();
    await db.delete(loginEmails);
    await db.delete(users);

    const result = await createInitialAccount({
      bookNames: ["共同支出"],
      email: "owner@example.com",
    });

    // The columns outlive the code that wrote them until a contract migration
    // drops them; nothing may fill them in the meantime.
    const row = await db.execute<{ password_hash: string | null }>(
      sql`SELECT password_hash FROM users WHERE id = ${result.userId}`
    );
    expect(row.rows).toEqual([{ password_hash: null }]);
  });

  /**
   * The action is what the browser can reach, and its job is to turn every
   * rejection into a code the wizard can show. A setup code is the gate, so a
   * request that did not carry a plausible one is a wrong code — not a generic
   * failure, and not a validation error the form cannot read.
   */
  describe("the setup action's verdicts", () => {
    const payload = {
      email: "owner@example.com",
      books: ["共同支出"],
    };

    it("answers a blank, short, or malformed code with wrong_code and creates nothing", async () => {
      const db = getTestDb();
      await db.delete(loginEmails);
      await db.delete(users);
      // A code is pending, so the answers below are about the shape of what was
      // sent rather than about there being nothing to compare it with.
      await getOrCreateSetupCode();

      for (const setupCode of ["", "   ", "12345", "not-a-code"]) {
        await expect(completeSetupAction({ ...payload, setupCode })).resolves.toEqual({
          ok: false,
          code: "wrong_code",
        });
      }
      // A missing field is the same answer as a blank one.
      await expect(completeSetupAction(payload)).resolves.toEqual({
        ok: false,
        code: "wrong_code",
      });

      expect(await isSetupPending()).toBe(true);
      expect(await db.select({ id: users.id }).from(users)).toHaveLength(0);
    });

    it("creates the account for the code it issued, and refuses it afterwards", async () => {
      const db = getTestDb();
      await db.delete(loginEmails);
      await db.delete(users);
      const { code } = await getOrCreateSetupCode();

      const result = await completeSetupAction({ ...payload, setupCode: code });
      if (!result.ok) throw new Error(`expected setup to succeed, got ${result.code}`);

      expect(await isSetupPending()).toBe(false);
      expect(
        await db.query.ledgers.findFirst({
          where: eq(ledgers.id, result.ledgerId),
        })
      ).toBeDefined();
      // The action is the unauthenticated write, so a second call must not
      // create a second account.
      await expect(completeSetupAction({ ...payload, setupCode: code })).resolves.toEqual({
        ok: false,
        code: "already_done",
      });
    });

    it("refuses a request that still carries a password, and creates nothing", async () => {
      const db = getTestDb();
      await db.delete(loginEmails);
      await db.delete(users);
      const { code } = await getOrCreateSetupCode();

      await expect(
        completeSetupAction({ ...payload, setupCode: code, password: "setup-pass-1" })
      ).resolves.toEqual({ ok: false, code: "unexpected" });

      expect(await isSetupPending()).toBe(true);
    });
  });
});
