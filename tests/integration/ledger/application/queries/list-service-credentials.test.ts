import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb } from "tests/setup";
import { createTestUserWithLedger } from "tests/helpers/schema-setup";
import { serviceCredentials } from "@/persistence";
import { listServiceCredentials as listServiceCredentialsUseCase } from "@/modules/ledger/application/queries/list-service-credentials";
import { serverComposition } from "@/application/server-composition-root";

const listServiceCredentials = (ledgerId: string) =>
  listServiceCredentialsUseCase(ledgerId, serverComposition.serviceCredentials);

describe("listServiceCredentials", () => {
  let ledgerId = "";

  beforeEach(async () => {
    const { ledgerId: createdLedgerId } = await createTestUserWithLedger(getTestDb());
    ledgerId = createdLedgerId;
  });

  it("returns active credentials sorted by newest first and mapped to DTOs", async () => {
    const db = getTestDb();

    await db.insert(serviceCredentials).values([
      {
        id: crypto.randomUUID(),
        ledgerId,
        name: "older",
        tokenHash: "a".repeat(64),
        tokenPrefix: "sk_older",
        tokenSuffix: "lder",
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
        lastUsedAt: new Date("2026-03-05T00:00:00.000Z"),
        attributedUserId: sql`(SELECT user_id FROM ledgers WHERE id = ${ledgerId})`,
      },
      {
        id: crypto.randomUUID(),
        ledgerId,
        name: "deleted",
        tokenHash: "b".repeat(64),
        tokenPrefix: "sk_delet",
        tokenSuffix: "eted",
        createdAt: new Date("2026-03-02T00:00:00.000Z"),
        deletedAt: new Date("2026-03-06T00:00:00.000Z"),
        attributedUserId: sql`(SELECT user_id FROM ledgers WHERE id = ${ledgerId})`,
      },
      {
        id: crypto.randomUUID(),
        ledgerId,
        name: "newest",
        tokenHash: "c".repeat(64),
        tokenPrefix: "sk_newes",
        tokenSuffix: "west",
        createdAt: new Date("2026-03-03T00:00:00.000Z"),
        attributedUserId: sql`(SELECT user_id FROM ledgers WHERE id = ${ledgerId})`,
      },
    ]);
    // Note: token_prefix/token_suffix are set for the test, but the adapter
    // returns them from the DB - these are just for valid DB state.
    // The adapter's list method returns tokenPrefix/tokenSuffix from the row.

    const result = await listServiceCredentials(ledgerId);

    expect(result.map((credential) => credential.name)).toEqual(["newest", "older"]);
    expect(result[0]?.createdAt).toBe("2026-03-03T00:00:00.000Z");
    expect(result[1]?.lastUsedAt).toBe("2026-03-05T00:00:00.000Z");
    expect(result.every((credential) => credential.deletedAt == null)).toBe(true);
  });
});
