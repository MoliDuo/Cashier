#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { z } from "zod";

const DATABASE_NAME = "cashier_test";
const IMAGE = "postgres:18-alpine";
const STARTUP_TIMEOUT_MS = 120_000;

const postgresTestUrlSchema = z
  .string()
  .trim()
  .regex(/^postgres(?:ql)?:\/\//, "TEST_DATABASE_URL must be a PostgreSQL connection URL")
  .superRefine((value, context) => {
    try {
      const databaseName = decodeURIComponent(new URL(value).pathname.replace(/^\//, ""));
      if (!databaseName.endsWith("_test")) {
        context.addIssue({
          code: "custom",
          message: "TEST_DATABASE_URL database name must end with _test",
        });
      }
    } catch {
      context.addIssue({ code: "custom", message: "TEST_DATABASE_URL must be a valid URL" });
    }
  });

export function createTestRunId() {
  return `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

export function sanitizeIdentifierPart(value) {
  const sanitized = value.replace(/[^a-zA-Z0-9_]/g, "_");
  if (sanitized.length === 0) throw new Error("Cannot derive a PostgreSQL identifier component");
  if (sanitized.length > 40) {
    throw new Error("CASHIER_TEST_RUN_ID is too long for a PostgreSQL test database name");
  }
  return sanitized;
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function validateTestDatabaseUrl(value) {
  return postgresTestUrlSchema.parse(value);
}

/** The database a run's file, or its template, lives in; every one shares the run prefix. */
export function runDatabaseName(runId, suffix) {
  return `test_${sanitizeIdentifierPart(runId)}_${sanitizeIdentifierPart(suffix)}`;
}

/** The same server and credentials as `baseUrl`, pointed at another database. */
export function databaseUrlFor(baseUrl, databaseName) {
  const url = new URL(baseUrl);
  url.pathname = `/${encodeURIComponent(databaseName)}`;
  return url.toString();
}

export async function listRunDatabases(pool, runId) {
  const prefix = `test_${sanitizeIdentifierPart(runId)}_`;
  const result = await pool.query(
    `SELECT datname
     FROM pg_database
     WHERE left(datname, char_length($1)) = $1
     ORDER BY datname`,
    [prefix]
  );
  return result.rows.map(({ datname }) => datname);
}

export async function cleanupRunDatabases(pool, runId, logger = console) {
  const prefix = `test_${sanitizeIdentifierPart(runId)}_`;
  const databases = await listRunDatabases(pool, runId);
  if (databases.length > 0) logger.info(`Cleaning ${databases.length} test databases`);

  for (const databaseName of databases) {
    if (!databaseName.startsWith(prefix)) {
      throw new Error(`Refusing to remove unexpected PostgreSQL database: ${databaseName}`);
    }
    await pool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`);
  }
}

async function verifyExternalDatabase(pool) {
  await pool.query("SELECT 1");
  const role = await pool.query(
    "SELECT rolcreatedb OR rolsuper AS can_create FROM pg_roles WHERE rolname = current_user"
  );
  if (role.rows[0]?.can_create !== true) {
    throw new Error("TEST_DATABASE_URL user must be allowed to create databases");
  }
}

async function defaultContainerFactory(options) {
  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
  return new PostgreSqlContainer(options.image)
    .withDatabase(options.database)
    .withUsername(options.username)
    .withPassword(options.password)
    .withStartupTimeout(options.startupTimeoutMs)
    .start();
}

async function startContainer(containerFactory) {
  try {
    return await containerFactory({
      image: IMAGE,
      database: DATABASE_NAME,
      username: "cashier",
      password: "cashier",
      startupTimeoutMs: STARTUP_TIMEOUT_MS,
    });
  } catch (error) {
    throw new Error(
      "Unable to start the test PostgreSQL container. Start Docker and retry; npm test remains available without Docker.",
      { cause: error }
    );
  }
}

export async function prepareTestPostgres({
  environment = process.env,
  runId = createTestRunId(),
  containerFactory = defaultContainerFactory,
  Pool = pg.Pool,
  logger = console,
} = {}) {
  const externalUrl = environment.TEST_DATABASE_URL?.trim();
  let container;
  let databaseUrl;
  let pool;

  try {
    if (externalUrl) {
      databaseUrl = validateTestDatabaseUrl(externalUrl);
      pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5_000 });
      try {
        await verifyExternalDatabase(pool);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`TEST_DATABASE_URL validation failed: ${message}`, { cause: error });
      }
    } else {
      container = await startContainer(containerFactory);
      databaseUrl = container.getConnectionUri();
      pool = new Pool({ connectionString: databaseUrl, max: 1 });
      await pool.query("SELECT 1");
    }

    let cleaned = false;
    return {
      databaseUrl,
      runId,
      async cleanup() {
        if (cleaned) return;
        cleaned = true;
        let cleanupError;
        try {
          await cleanupRunDatabases(pool, runId, logger);
        } catch (error) {
          cleanupError = error;
        } finally {
          await pool.end().catch((error) => {
            cleanupError ??= error;
          });
          await container?.stop().catch((error) => {
            cleanupError ??= error;
          });
        }
        if (cleanupError) throw cleanupError;
      },
    };
  } catch (error) {
    await pool?.end().catch(() => {});
    await container?.stop().catch(() => {});
    throw error;
  }
}

async function main() {
  const resource = await prepareTestPostgres();
  try {
    console.info("Test PostgreSQL environment is ready.");
  } finally {
    await resource.cleanup();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
