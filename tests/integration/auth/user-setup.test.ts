import { describe, it, expect } from "vitest";
import { eq, and, isNull } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { ledgers, users } from "@/persistence";
import { resolveHome } from "@/modules/workspace/application/use-cases/resolve-home";
import { serverComposition } from "@/application/server-composition-root";
import {
  createTestUserWithLedger,
  TEST_PARTNER_USER_ID,
  TEST_USER_ID,
} from "../../helpers/schema-setup";
import { UnauthorizedError } from "@/lib/errors";

const getHome = (userId: string) => resolveHome(userId, serverComposition.ledgers);

describe("shared home", () => {
  it("rejects a new user without creating another ledger", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const testUserId = crypto.randomUUID();
    const testEmail = "newuser@example.com";

    await db
      .insert(users)
      .values({
        id: testUserId,
        email: testEmail,
        name: "New User",
      })
      .onConflictDoNothing();

    await expect(getHome(testUserId)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(await db.select().from(ledgers)).toHaveLength(1);
    expect((await db.select().from(ledgers))[0]?.id).toBe(ledgerId);
  });

  it("resolves the same existing ledger for both members without creating another", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const first = await getHome(TEST_USER_ID);
    const second = await getHome(TEST_PARTNER_USER_ID);

    expect(first.id).toBe(ledgerId);
    expect(second.id).toBe(ledgerId);

    const activeLedgers = await db.query.ledgers.findMany({
      where: and(eq(ledgers.userId, TEST_USER_ID), isNull(ledgers.deletedAt)),
    });
    expect(activeLedgers).toHaveLength(1);
  });
});
