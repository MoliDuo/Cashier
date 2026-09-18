import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { ledgers, loginEmails, users } from "@/persistence";
import { eq, sql } from "drizzle-orm";

const LEDGER_ONE_ID = "00000000-0000-4000-8000-000000000001";
const LEDGER_TWO_ID = "00000000-0000-4000-8000-000000000002";

async function createTestUser(email?: string) {
  const id = crypto.randomUUID();
  const [user] = await db.insert(users).values({ id, name: "Test User" }).returning();
  await db.insert(loginEmails).values({
    userId: id,
    email: email ?? `test-${id}@example.com`,
    emailVerified: new Date(),
  });
  expect(user).toBeDefined();
  if (user === undefined) {
    throw new Error("Expected user insert to return a row");
  }
  return user;
}

describe("Ledger single limit constraint", () => {
  beforeEach(async () => {
    // Clean up test data - use raw SQL for cleanup to avoid relation issues
    await db.delete(ledgers).where(eq(ledgers.id, LEDGER_ONE_ID));
    await db.delete(ledgers).where(eq(ledgers.id, LEDGER_TWO_ID));
  });

  it("should allow creating first ledger for user", async () => {
    const user = await createTestUser();

    // 创建第一个账本
    const [ledger] = await db
      .insert(ledgers)
      .values({
        id: LEDGER_ONE_ID,
        userId: user.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    expect(ledger).toBeDefined();
    expect(ledger?.userId).toBe(user.id);
  });

  it("keeps the one-live-ledger rule in the adapter rather than a constraint", async () => {
    // `uniq_ledgers_user_id` is gone: a person may now have more than one
    // ledger row, and "there is exactly one live ledger" is what the access
    // port enforces. This pins that the constraint really was dropped, so a
    // future schema change cannot quietly resurrect the old cap.
    const constraints = await db.execute(
      sql`SELECT indexname FROM pg_indexes
           WHERE schemaname = current_schema() AND indexname = 'uniq_ledgers_user_id'`
    );
    expect(constraints.rows).toHaveLength(0);
  });

  it("should allow different users to each have one ledger", async () => {
    const user1 = await createTestUser("user1@test.com");
    const user2 = await createTestUser("user2@test.com");

    // 用户1创建账本
    const [ledger1] = await db
      .insert(ledgers)
      .values({
        id: LEDGER_ONE_ID,
        userId: user1.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // 用户2创建账本
    const [ledger2] = await db
      .insert(ledgers)
      .values({
        id: LEDGER_TWO_ID,
        userId: user2.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    expect(ledger1).toBeDefined();
    expect(ledger2).toBeDefined();
    expect(ledger1?.userId).toBe(user1.id);
    expect(ledger2?.userId).toBe(user2.id);
  });
});
