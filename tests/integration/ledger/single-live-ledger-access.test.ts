import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import {
  createTestUser,
  createTestUserWithLedger,
  ensureTestLedgerBooks,
} from "tests/helpers/schema-setup";
import { ledgers, storedFiles, users } from "@/persistence";
import { readAuthorizedFile } from "@/server/stored-files/reads";
import { getLiveLedger } from "@/modules/ledger/server/live-ledger";
import { createTestSourceDocument } from "tests/helpers/schema-setup";

vi.mock("@/lib/storage/s3", () => ({
  getS3Storage: () => ({ download: async () => Buffer.from("fixture") }),
}));

/**
 * The access rule that replaced the `COUPLE_*` config: the account must be live
 * and the ledger must be the single live one. Nothing is read from the
 * environment, so "exactly one live ledger" is the whole authorization here.
 */
describe("single live ledger access", () => {
  it("lets the live account reach the live ledger and refuses a deleted account", async () => {
    const db = getTestDb();
    const { userId, ledgerId } = await createTestUserWithLedger(db);

    expect(await getLiveLedger(userId)).toMatchObject({ id: ledgerId });

    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, userId));
    expect(await getLiveLedger(userId)).toBeNull();
  });

  it("refuses an account that does not exist", async () => {
    await createTestUserWithLedger(getTestDb());
    expect(await getLiveLedger(crypto.randomUUID())).toBeNull();
  });

  it("fails closed when no ledger is live, and when more than one is", async () => {
    const db = getTestDb();
    const { userId, ledgerId } = await createTestUserWithLedger(db);
    const secondLedgerId = crypto.randomUUID();
    await db.insert(ledgers).values({ id: secondLedgerId, userId });
    await ensureTestLedgerBooks(db, secondLedgerId);

    // Two live ledgers make "the single ledger" ambiguous: resolution closes
    // rather than picking one. 0048's guard refuses this state as well.
    expect(await getLiveLedger(userId)).toBeNull();

    await db.update(ledgers).set({ deletedAt: new Date() }).where(eq(ledgers.id, secondLedgerId));
    expect(await getLiveLedger(userId)).toMatchObject({ id: ledgerId });

    await db.update(ledgers).set({ deletedAt: new Date() }).where(eq(ledgers.id, ledgerId));
    expect(await getLiveLedger(userId)).toBeNull();
  });

  it("scopes file reads to the live ledger and a live account", async () => {
    const db = getTestDb();
    const { userId, ledgerId } = await createTestUserWithLedger(db);
    // There is one account, so "who may read this file" is "is the account
    // live", not "does the account match the record's owner".
    const deleted = await createTestUser(db, undefined, crypto.randomUUID());
    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, deleted));

    await createTestSourceDocument(db, ledgerId, { imageUrls: ["fixture"] });
    const file = (await db.select().from(storedFiles))[0]!;
    const readAs = async (id: string) => {
      const ledger = await getLiveLedger(id);
      return ledger == null ? null : readAuthorizedFile(ledger.id, file.id);
    };
    expect(await readAs(userId)).not.toBeNull();
    expect(await readAs(deleted)).toBeNull();
  });

  it("never provisions a personal ledger for an account without one", async () => {
    const db = getTestDb();
    const userId = await createTestUser(db, undefined, crypto.randomUUID());
    expect(await getLiveLedger(userId)).toBeNull();
    expect(await db.query.ledgers.findFirst({ where: eq(ledgers.userId, userId) })).toBeUndefined();
  });
});
