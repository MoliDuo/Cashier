import { afterAll, beforeAll, beforeEach, inject, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/persistence";
import { databaseUrlFor, runDatabaseName } from "../scripts/prepare-test-postgres.mjs";
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

/** TRUNCATE only after all request-bound work has settled. */
async function truncateAllTables(database: TestDatabase): Promise<void> {
  const tables = await database.pool.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = current_schema()
       AND table_type = 'BASE TABLE'
     ORDER BY table_name`
  );
  const tableNames = tables.rows.map(
    ({ table_name }) => `${quoteIdentifier(DATA_SCHEMA)}.${quoteIdentifier(table_name)}`
  );
  if (tableNames.length === 0) return;
  const statement = `TRUNCATE TABLE ${tableNames.join(", ")} RESTART IDENTITY CASCADE`;
  await database.pool.query(statement);
}

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
  await administer(`DROP DATABASE IF EXISTS ${quoteIdentifier(DATABASE_NAME)} WITH (FORCE)`);
});

beforeEach(async () => {
  // Drain request-bound `after()` work from the previous test before taking
  // exclusive table locks, otherwise maintenance/processing transactions can
  // deadlock against the per-test TRUNCATE.
  await flushAfterCallbacks();
  const database = testDatabase;
  if (database == null) throw new Error("Test PostgreSQL database is not initialized");

  await truncateAllTables(database);

  await database.db.insert(schema.users).values({
    id: "00000000-0000-0000-0000-000000000000",
  });
  await database.db.insert(schema.loginEmails).values({
    userId: "00000000-0000-0000-0000-000000000000",
    email: "test@example.com",
    emailVerified: new Date(),
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
