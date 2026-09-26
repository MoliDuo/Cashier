import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/persistence";
import { runtimeEnv } from "@/lib/env/runtime";
import { resolvePostgresSsl } from "@/lib/db/ssl";

const globalForDb = global as unknown as {
  pool: Pool | undefined;
};

const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: runtimeEnv.databaseUrl,
    ssl: resolvePostgresSsl(runtimeEnv.databaseUrl, process.env.NODE_ENV),
    max: runtimeEnv.databasePoolMax,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 30_000,
  });

globalForDb.pool = pool;

export const db = drizzle(pool, { schema });

/** Ends the pool, so a command-line script can exit once its work is done. */
export async function closeDatabase(): Promise<void> {
  globalForDb.pool = undefined;
  await pool.end();
}
