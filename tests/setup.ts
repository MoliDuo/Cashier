import path from "node:path";
import { afterAll, beforeAll, beforeEach, inject, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "@/persistence";
import { flushAfterCallbacks } from "./setup.common";

const postgresContext = inject("cashierPostgres");
const TEST_DATABASE_URL = postgresContext.databaseUrl;
const TEST_RUN_ID = postgresContext.runId;
// VITEST_POOL_ID identifies a reusable worker slot; VITEST_WORKER_ID identifies the
// isolated worker instance, so both are part of the schema name.
const VITEST_POOL_ID = requireEnvironment("VITEST_POOL_ID");
const VITEST_WORKER_ID = requireEnvironment("VITEST_WORKER_ID");
const SCHEMA_NAME = `test_${sanitizeIdentifierPart(TEST_RUN_ID)}_p${sanitizeIdentifierPart(
  VITEST_POOL_ID
)}_w${sanitizeIdentifierPart(VITEST_WORKER_ID)}`;

process.env.DATABASE_URL = TEST_DATABASE_URL;

interface TestDatabase {
  pool: Pool;
  db: ReturnType<typeof drizzle<typeof schema>>;
  schemaName: string;
}

let testDatabase: TestDatabase | undefined;

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (value == null || value === "") {
    throw new Error(
      `Missing ${name}. Run database-backed tests through the npm test scripts so test schemas are isolated.`
    );
  }
  return value;
}

function sanitizeIdentifierPart(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_]/g, "_");
  if (sanitized.length === 0) throw new Error("Cannot derive a PostgreSQL schema name");
  if (sanitized.length > 40) {
    throw new Error("CASHIER_TEST_RUN_ID is too long for a PostgreSQL schema name");
  }
  return sanitized;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function advisoryLockKey(schemaName: string): string {
  return `cashier-test-schema:${schemaName}`;
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
  if (testDatabase == null) throw new Error("Test PostgreSQL database is not initialized");
  return testDatabase.schemaName;
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
    ({ table_name }) => `${quoteIdentifier(database.schemaName)}.${quoteIdentifier(table_name)}`
  );
  if (tableNames.length === 0) return;
  const statement = `TRUNCATE TABLE ${tableNames.join(", ")} RESTART IDENTITY CASCADE`;
  await database.pool.query(statement);
}

beforeAll(async () => {
  const admin = new Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
  const adminClient = await admin.connect();
  let pool: Pool | undefined;

  try {
    await adminClient.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
      advisoryLockKey(SCHEMA_NAME),
    ]);
    await adminClient.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(SCHEMA_NAME)}`);

    pool = new Pool({
      connectionString: TEST_DATABASE_URL,
      options: `-c search_path=${quoteIdentifier(SCHEMA_NAME)},public`,
      max: 2,
    });
    const db = drizzle(pool, { schema });
    await migrate(db, {
      migrationsFolder: path.resolve("src/persistence/postgres-migrations"),
      migrationsSchema: `${SCHEMA_NAME}_migrations`,
    });
    testDatabase = { pool, db, schemaName: SCHEMA_NAME };
  } catch (error) {
    await pool?.end();
    throw error;
  } finally {
    await adminClient.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
      advisoryLockKey(SCHEMA_NAME),
    ]);
    adminClient.release();
    await admin.end();
  }
});

afterAll(async () => {
  await flushAfterCallbacks();
  await testDatabase?.pool.end();
  testDatabase = undefined;
});

beforeEach(async () => {
  // Drain request-bound `after()` work from the previous test before taking
  // exclusive table locks, otherwise maintenance/processing transactions can
  // deadlock against the per-test TRUNCATE.
  await flushAfterCallbacks();
  const database = testDatabase;
  if (database == null) throw new Error("Test PostgreSQL database is not initialized");

  delete process.env.COUPLE_OWNER_USER_ID;
  delete process.env.COUPLE_PARTNER_USER_ID;
  delete process.env.COUPLE_LEDGER_ID;

  await truncateAllTables(database);

  await database.db.insert(schema.users).values({
    id: "00000000-0000-0000-0000-000000000000",
    email: "test@example.com",
    name: "Test User",
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
