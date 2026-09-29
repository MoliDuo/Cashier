import { describe, expect, it } from "vitest";
import { getTestDb } from "tests/setup";
import { createTestUser, createTestUserWithLedger } from "tests/helpers/schema-setup";
import { ledgers } from "@/persistence";
import { getLedger } from "@/modules/ledger/server/live-ledger";

describe("single live ledger access", () => {
  it("reaches the ledger once it exists", async () => {
    await createTestUserWithLedger(getTestDb());
    expect(await getLedger()).toMatchObject({ settings: { mainCurrency: "CNY" } });
  });

  it("fails closed when there is no ledger yet, and never provisions one", async () => {
    const db = getTestDb();
    await createTestUser(db, undefined, crypto.randomUUID());
    expect(await getLedger()).toBeNull();
    expect(await db.select().from(ledgers)).toEqual([]);
  });
});
