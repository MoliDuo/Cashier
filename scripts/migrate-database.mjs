#!/usr/bin/env node
import path from "node:path";
import { loadLocalEnvironment } from "./load-local-environment.mjs";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { validateCoupleUpgrade } from "./validate-couple-upgrade.mjs";
import { z } from "zod";

async function coupleMergeState(client) {
  const [{ rows: users }, { rows: ledgers }] = await Promise.all([
    client.query("SELECT count(*)::int AS count FROM users"),
    client.query(
      `SELECT id, user_id, deleted_at FROM ledgers
       WHERE user_id = ANY($1::uuid[]) ORDER BY id`,
      [[process.env.COUPLE_OWNER_USER_ID, process.env.COUPLE_PARTNER_USER_ID]]
    ),
  ]);
  if (users[0].count === 0 && ledgers.length === 0) return "empty";
  const ids = z
    .object({ owner: z.string().uuid(), partner: z.string().uuid(), ledger: z.string().uuid() })
    .refine(({ owner, partner }) => owner !== partner)
    .parse({
      owner: process.env.COUPLE_OWNER_USER_ID,
      partner: process.env.COUPLE_PARTNER_USER_ID,
      ledger: process.env.COUPLE_LEDGER_ID,
    });
  const owner = ledgers.filter((row) => row.user_id === ids.owner && !row.deleted_at);
  const partner = ledgers.filter((row) => row.user_id === ids.partner && !row.deleted_at);
  if (owner.length !== 1 || owner[0].id !== ids.ledger || partner.length > 1)
    throw new Error("Configured shared ledger or member ledger set is invalid");
  if (partner.length === 1) return { mode: "merge", ids };

  // A retired partner ledger must not still hold records after a prior merge.
  const retired = ledgers.filter((row) => row.user_id === ids.partner).map((row) => row.id);
  if (retired.length) {
    const tables = await client.query(
      `SELECT DISTINCT table_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND column_name = 'ledger_id'
         AND table_name <> 'ledgers'`
    );
    for (const { table_name } of tables.rows) {
      const table = `"${table_name.replaceAll('"', '""')}"`;
      const result = await client.query(
        `SELECT 1 FROM ${table} WHERE ledger_id = ANY($1::uuid[]) LIMIT 1`,
        [retired]
      );
      if (result.rowCount) throw new Error(`Retired partner ledger still has records in ${table}`);
    }
  }
  return "ready";
}

async function main() {
  loadLocalEnvironment();
  const connectionString = process.env.DATABASE_URL;
  if (connectionString == null || !/^postgres(ql)?:\/\//.test(connectionString)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [112835438754]);
    try {
      await validateCoupleUpgrade(client);
      const schema = (await client.query("SELECT current_schema() AS name")).rows[0].name;
      await migrate(drizzle(client), {
        migrationsFolder: path.resolve("src/persistence/postgres-migrations"),
        migrationsSchema: schema === "public" ? "drizzle" : `${schema}_migrations`,
      });
      const state = await coupleMergeState(client);
      let merge;
      if (typeof state === "object") {
        // Drizzle commits its schema transaction first. The entire data merge
        // and its integrity checks run together in this separate transaction.
        await client.query("BEGIN");
        try {
          await client.query("SET LOCAL lock_timeout = '10s'");
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended('cashier-couple-merge', 0))"
          );
          const { mergeCoupleLedger } = await import("./migrate-couple-ledger.ts");
          merge = await mergeCoupleLedger(client, state.ids);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
      console.log(
        JSON.stringify({
          mode: "migrate",
          database: "postgresql",
          status: "complete",
          couple: merge ? "merged" : state,
          ...(merge ? { merge } : {}),
        })
      );
    } finally {
      await client.query("select pg_advisory_unlock($1)", [112835438754]);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[db:migrate] ${error instanceof Error ? error.message : String(error)}`);
  // Drizzle wraps the underlying PostgreSQL error in `error.cause`; print the
  // whole cause chain so deployment logs show the real failure reason.
  let cause = error?.cause;
  while (cause instanceof Error) {
    console.error(`[db:migrate] caused by: ${cause.message}`);
    cause = cause.cause;
  }
  process.exitCode = 1;
});
