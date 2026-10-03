import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/persistence";
import { runtimeEnv } from "@/lib/env/runtime";
import { resolvePostgresSsl } from "@/lib/db/ssl";

const globalForDb = global as unknown as {
  pool: Pool | undefined;
};

function createPool(): Pool {
  const created = new Pool({
    connectionString: runtimeEnv.databaseUrl,
    ssl: resolvePostgresSsl(runtimeEnv.databaseUrl, process.env.NODE_ENV),
    max: runtimeEnv.databasePoolMax,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 30_000,
  });
  return created;
}

const pool = globalForDb.pool ?? createPool();

globalForDb.pool = pool;

export const db = drizzle(pool, { schema });

/** The pool itself, for the few callers that need a dedicated session (advisory locks). */
export const databasePool: Pool = pool;

/** Ends the pool, so a command-line script can exit once its work is done. */
export async function closeDatabase(): Promise<void> {
  globalForDb.pool = undefined;
  await pool.end();
}
