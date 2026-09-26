import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import {
  createTestUser,
  createTestUserWithLedger,
  ensureTestLedgerBooks,
} from "tests/helpers/schema-setup";
import { ledgers, storedFiles } from "@/persistence";
import { readAuthorizedFile } from "@/server/stored-files/reads";
import { getLiveLedger } from "@/modules/ledger/server/live-ledger";
import { createTestSourceDocument } from "tests/helpers/schema-setup";

vi.mock("@/lib/storage/s3", () => ({
  getS3Storage: () => ({ download: async () => Buffer.from("fixture") }),
}));

/**
 * The access rule that replaced the `COUPLE_*` config: the account must exist
 * and the ledger must be the only one. Nothing is read from the environment, so
 * "exactly one ledger" is the whole authorization here.
 */
describe("single live ledger access", () => {
  it("lets the account reach the ledger", async () => {
    const { userId, ledgerId } = await createTestUserWithLedger(getTestDb());
    expect(await getLiveLedger(userId)).toMatchObject({ id: ledgerId });
  });

  it("refuses an account that does not exist", async () => {
    await createTestUserWithLedger(getTestDb());
    expect(await getLiveLedger(crypto.randomUUID())).toBeNull();
  });

  it("fails closed when there is no ledger, and when there is more than one", async () => {
    const db = getTestDb();
    const userId = await createTestUser(db);
    expect(await getLiveLedger(userId)).toBeNull();

    const { ledgerId } = await createTestUserWithLedger(db, undefined, undefined, userId);
    const secondLedgerId = crypto.randomUUID();
    await db.insert(ledgers).values({ id: secondLedgerId });
    await ensureTestLedgerBooks(db, secondLedgerId);

    // Two ledgers make "the single ledger" ambiguous: resolution closes rather
    // than picking one.
    expect(await getLiveLedger(userId)).toBeNull();

    await db.delete(ledgers).where(eq(ledgers.id, secondLedgerId));
    expect(await getLiveLedger(userId)).toMatchObject({ id: ledgerId });
  });

  it("scopes file reads to the ledger and an existing account", async () => {
    const db = getTestDb();
    const { userId, ledgerId } = await createTestUserWithLedger(db);

    await createTestSourceDocument(db, ledgerId, { imageUrls: ["fixture"] });
    const file = (await db.select().from(storedFiles))[0]!;
    const readAs = async (id: string) => {
      const ledger = await getLiveLedger(id);
      return ledger == null ? null : readAuthorizedFile(ledger.id, file.id);
    };
    expect(await readAs(userId)).not.toBeNull();
    expect(await readAs(crypto.randomUUID())).toBeNull();
  });

  it("never provisions a ledger for an account without one", async () => {
    const db = getTestDb();
    const userId = await createTestUser(db, undefined, crypto.randomUUID());
    expect(await getLiveLedger(userId)).toBeNull();
    expect(await db.select().from(ledgers)).toEqual([]);
  });
});
