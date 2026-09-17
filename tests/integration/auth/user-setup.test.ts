import { describe, it, expect } from "vitest";
import { eq, and, isNull } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { ledgers, users } from "@/persistence";
import { ensureUserLedger as ensureUserLedgerUseCase } from "@/modules/workspace/application/use-cases/ensure-user-ledger";
import { serverComposition } from "@/application/server-composition-root";
import {
  createTestUserWithLedger,
  TEST_PARTNER_USER_ID,
  TEST_USER_ID,
} from "../../helpers/schema-setup";
import { UnauthorizedError } from "@/lib/errors";

const ensureUserLedger = (input: Parameters<typeof ensureUserLedgerUseCase>[0]) =>
  ensureUserLedgerUseCase(input, serverComposition.ledgers);

describe("ensureUserLedger", () => {
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

    await expect(ensureUserLedger({ userId: testUserId, locale: "en" })).rejects.toBeInstanceOf(
      UnauthorizedError
    );
    expect(await db.select().from(ledgers)).toHaveLength(1);
    expect((await db.select().from(ledgers))[0]?.id).toBe(ledgerId);
  });

  it("resolves the same existing ledger for both members without creating another", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const first = await ensureUserLedger({ userId: TEST_USER_ID, locale: "zh" });
    const second = await ensureUserLedger({ userId: TEST_PARTNER_USER_ID, locale: "en" });

    expect(first.ledger.id).toBe(ledgerId);
    expect(second.ledger.id).toBe(ledgerId);
    expect(first.created).toBe(false);
    expect(second.created).toBe(false);

    const activeLedgers = await db.query.ledgers.findMany({
      where: and(eq(ledgers.userId, TEST_USER_ID), isNull(ledgers.deletedAt)),
    });
    expect(activeLedgers).toHaveLength(1);
  });
});
