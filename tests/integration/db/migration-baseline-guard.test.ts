import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertBaselineReached } from "../../../scripts/migrate-database.mjs";
import { getTestPool, getTestSchemaName } from "../../setup";

const journal = JSON.parse(
  readFileSync("src/persistence/postgres-migrations/meta/_journal.json", "utf8")
) as { entries: Array<{ tag: string; when: number }> };
const baselineWhen = journal.entries.find((entry) => entry.tag === "0000_baseline")!.when;

/** Runs the guard against a throwaway migrations schema holding `createdAt`, if any. */
async function guardWithRecordedMigration(createdAt: number | null) {
  const schema = `${getTestSchemaName()}_guard`;
  const client = await getTestPool().connect();
  try {
    await client.query(`CREATE SCHEMA ${client.escapeIdentifier(schema)}`);
    await client.query(
      `CREATE TABLE ${client.escapeIdentifier(schema)}.__drizzle_migrations
         (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)`
    );
    if (createdAt != null) {
      await client.query(
        `INSERT INTO ${client.escapeIdentifier(schema)}.__drizzle_migrations (hash, created_at)
         VALUES ('hash', $1)`,
        [createdAt]
      );
    }
    return await assertBaselineReached(client, schema);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${client.escapeIdentifier(schema)} CASCADE`);
    client.release();
  }
}

describe("migration baseline guard", () => {
  it("refuses a database whose last migration predates the baseline", async () => {
    await expect(guardWithRecordedMigration(baselineWhen - 1)).rejects.toThrow(
      /predates the migration baseline; deploy the `pre-baseline` git tag first/
    );
  });

  it("lets a database that reached the baseline apply what follows it", async () => {
    await expect(guardWithRecordedMigration(baselineWhen)).resolves.toBeUndefined();
  });

  it("lets an empty or brand-new database build from the baseline", async () => {
    await expect(guardWithRecordedMigration(null)).resolves.toBeUndefined();
    const client = await getTestPool().connect();
    try {
      await expect(
        assertBaselineReached(client, `${getTestSchemaName()}_missing`)
      ).resolves.toBeUndefined();
    } finally {
      client.release();
    }
  });
});
