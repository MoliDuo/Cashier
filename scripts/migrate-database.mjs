#!/usr/bin/env node
import path from "node:path";
import { loadLocalEnvironment } from "./load-local-environment.mjs";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

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
      await migrate(drizzle(client), {
        migrationsFolder: path.resolve("src/persistence/postgres-migrations"),
        migrationsSchema: schema === "public" ? "drizzle" : `${schema}_migrations`,
      });
      console.log(JSON.stringify({ mode: "migrate", database: "postgresql", status: "complete" }));
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
