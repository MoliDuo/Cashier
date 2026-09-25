#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadLocalEnvironment } from "./load-local-environment.mjs";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const migrationsFolder = path.resolve("src/persistence/postgres-migrations");

/**
 * The migrations before `0000_baseline` were folded into it. Drizzle skips every
 * migration not newer than the last one a database recorded, so a database
 * that stopped short of the baseline would silently miss the folded changes.
 * Refuse it instead; the `pre-baseline` tag still carries the full chain.
 *
 * @param {pg.Client} client
 * @param {string} migrationsSchema
 */
export async function assertBaselineReached(client, migrationsSchema) {
  const journal = JSON.parse(
    readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8")
  );
  const baseline = journal.entries.find((entry) => entry.tag === "0000_baseline");
  if (baseline == null) throw new Error("migration journal has no 0000_baseline entry");
  const table = `${client.escapeIdentifier(migrationsSchema)}.__drizzle_migrations`;
  const exists = await client.query("SELECT to_regclass($1) IS NOT NULL AS exists", [table]);
  if (exists.rows[0].exists !== true) return;
  const latest = await client.query(`SELECT max(created_at)::text AS latest FROM ${table}`);
  const applied = latest.rows[0].latest;
  if (applied == null || Number(applied) >= baseline.when) return;
  throw new Error(
    "this database predates the migration baseline; deploy the `pre-baseline` git tag " +
      "first so it applies the migrations folded into 0000_baseline, then deploy this release"
  );
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
      const schema = (await client.query("SELECT current_schema() AS name")).rows[0].name;
      const migrationsSchema = schema === "public" ? "drizzle" : `${schema}_migrations`;
      await assertBaselineReached(client, migrationsSchema);
      await migrate(drizzle(client), { migrationsFolder, migrationsSchema });
      console.log(JSON.stringify({ mode: "migrate", database: "postgresql", status: "complete" }));
    } finally {
      await client.query("select pg_advisory_unlock($1)", [112835438754]);
    }
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
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
