import { afterAll, beforeAll, beforeEach, inject, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { setTimeout } from "node:timers";
import { Pool } from "pg";
import * as schema from "@/persistence";
import { databaseUrlFor, runDatabaseName } from "../scripts/prepare-test-postgres";
import { seedUser } from "../scripts/lib/seed";
import { flushAfterCallbacks } from "./setup.common";

const postgresContext = inject("cashierPostgres");
// VITEST_POOL_ID identifies a reusable worker slot; VITEST_WORKER_ID identifies the
// isolated worker instance, so both are part of the database name.
const DATABASE_NAME = runDatabaseName(
  postgresContext.runId,
  `p${requireEnvironment("VITEST_POOL_ID")}_w${requireEnvironment("VITEST_WORKER_ID")}`
);
const DATABASE_URL = databaseUrlFor(postgresContext.databaseUrl, DATABASE_NAME);
// The copy is laid out like production: tables in public, the migration log in drizzle.
const DATA_SCHEMA = "public";
const MIGRATIONS_SCHEMA = "drizzle";

process.env.DATABASE_URL = DATABASE_URL;

interface TestDatabase {
  pool: Pool;
  db: ReturnType<typeof drizzle<typeof schema>>;
}

let testDatabase: TestDatabase | undefined;

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (value == null || value === "") {
    throw new Error(
      `Missing ${name}. Run database-backed tests through the npm test scripts so test databases are isolated.`
    );
  }
  return value;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function getTestDb() {
  if (testDatabase == null) {
    throw new Error("Test PostgreSQL database is not initialized");
  }
  return testDatabase.db;
}

export function getTestPool() {
  if (testDatabase == null) {
    throw new Error("Test PostgreSQL database is not initialized");
  }
  return testDatabase.pool;
}

export function getTestSchemaName(): string {
  return DATA_SCHEMA;
}

export function getTestMigrationsSchemaName(): string {
  return MIGRATIONS_SCHEMA;
}

/** Runs a statement against the server outside this file's database. */
async function administer(statement: string): Promise<void> {
  const admin = new Pool({ connectionString: postgresContext.databaseUrl, max: 1 });
  try {
    await admin.query(statement);
  } finally {
    await admin.end();
  }
}

/**
 * Drops this file's database once its connections have gone. `pool.end()`
 * resolves before the server has closed them, and forcing the drop straight
 * away terminates a backend that is already leaving: its client reports
 * 57P01 after the pool stopped listening, which fails the run. FORCE is left
 * for connections that are still open after the wait.
 */
async function dropFileDatabase(): Promise<void> {
  const admin = new Pool({ connectionString: postgresContext.databaseUrl, max: 1 });
  try {
    // Counted rather than timed, and on node:timers, so a test that left fake
    // timers installed cannot stall or skip the wait.
    for (let attempt = 0; attempt < 250; attempt += 1) {
      const { rows } = await admin.query<{ open: number }>(
        "SELECT count(*)::int AS open FROM pg_stat_activity WHERE datname = $1",
        [DATABASE_NAME]
      );
      if (rows[0]?.open === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(DATABASE_NAME)} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

/**
 * Empties every base table in the copy, including ones a test created, in one
 * round trip. TRUNCATE rewrites each table and index file, which cost about
 * 50 ms before every test; deleting a test's few rows costs almost nothing.
 * With `session_replication_role = replica` neither foreign keys nor the
 * change-log triggers fire, so the result matches TRUNCATE … CASCADE (the
 * schema has no identity columns for RESTART IDENTITY to reset). A role that
 * may not set the parameter, possible under TEST_DATABASE_URL, truncates.
 * Run it only after all request-bound work has settled.
 */
const EMPTY_ALL_TABLES = `DO $empty$
DECLARE
  table_list text;
  table_name text;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ' ORDER BY tablename)
  INTO table_list
  FROM pg_tables
  WHERE schemaname = current_schema();
  IF table_list IS NULL THEN
    RETURN;
  END IF;
  IF has_parameter_privilege('session_replication_role', 'SET') THEN
    SET LOCAL session_replication_role = replica;
    FOR table_name IN
      SELECT format('%I.%I', schemaname, tablename) FROM pg_tables WHERE schemaname = current_schema()
    LOOP
      EXECUTE 'DELETE FROM ' || table_name;
    END LOOP;
  ELSE
    EXECUTE format('TRUNCATE TABLE %s RESTART IDENTITY CASCADE', table_list);
  END IF;
END
$empty$`;

beforeAll(async () => {
  await administer(
    `CREATE DATABASE ${quoteIdentifier(DATABASE_NAME)} TEMPLATE ${quoteIdentifier(
      postgresContext.templateDatabase
    )}`
  );
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  testDatabase = { pool, db: drizzle(pool, { schema }) };
});

afterAll(async () => {
  await flushAfterCallbacks();
  await testDatabase?.pool.end();
  testDatabase = undefined;
  await dropFileDatabase();
});

beforeEach(async () => {
  // Drain request-bound `after()` work from the previous test before emptying
  // the tables, otherwise maintenance/processing transactions can deadlock
  // against the per-test cleanup.
  await flushAfterCallbacks();
  const database = testDatabase;
  if (database == null) throw new Error("Test PostgreSQL database is not initialized");

  await database.pool.query(EMPTY_ALL_TABLES);

  await seedUser(database.db, {
    id: "00000000-0000-0000-0000-000000000000",
    email: "test@example.com",
  });
});

vi.mock("@/lib/db", () => ({
  get db() {
    return getTestDb();
  },
  get databasePool() {
    return getTestPool();
  },
}));
