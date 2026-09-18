import { describe, it, expect } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { ledgers } from "@/persistence";
import { resolveHome } from "@/modules/workspace/application/use-cases/resolve-home";
import { serverComposition } from "@/application/server-composition-root";
import { createTestUserWithLedger, TEST_USER_ID } from "../../helpers/schema-setup";
import { UnauthorizedError } from "@/lib/errors";

const getHome = (userId: string) => resolveHome(userId, serverComposition.ledgers);

describe("home ledger resolution", () => {
  it("rejects an account that does not exist", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);

    await expect(getHome(crypto.randomUUID())).rejects.toBeInstanceOf(UnauthorizedError);
    expect(await db.select().from(ledgers)).toHaveLength(1);
    expect((await db.select().from(ledgers))[0]?.id).toBe(ledgerId);
  });

  it("resolves the single live ledger for the signed-in account", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);

    const home = await getHome(TEST_USER_ID);
    expect(home.id).toBe(ledgerId);

    const activeLedgers = await db.query.ledgers.findMany({
      where: and(eq(ledgers.userId, TEST_USER_ID), isNull(ledgers.deletedAt)),
    });
    expect(activeLedgers).toHaveLength(1);
  });

  it("refuses when the ledger is deleted", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    await db.update(ledgers).set({ deletedAt: new Date() }).where(eq(ledgers.id, ledgerId));

    await expect(getHome(TEST_USER_ID)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("refuses when a second live ledger exists", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);
    // Two live ledgers mean "the single ledger" is ambiguous, so resolution
    // closes rather than picking one; 0048's guard refuses this state too.
    await db.insert(ledgers).values({ userId: TEST_USER_ID });

    await expect(getHome(TEST_USER_ID)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
