import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type { TestProject } from "vitest/node";
import {
  databaseUrlFor,
  prepareTestPostgres,
  runDatabaseName,
} from "../scripts/prepare-test-postgres.mjs";

export interface CashierPostgresContext {
  databaseUrl: string;
  runId: string;
  templateDatabase: string;
}

declare module "vitest" {
  export interface ProvidedContext {
    cashierPostgres: CashierPostgresContext;
  }
}

/**
 * Migrates one template database per run; each test file then starts from a
 * copy of it instead of replaying every migration itself.
 */
async function createTemplate(databaseUrl: string, runId: string): Promise<string> {
  const templateDatabase = runDatabaseName(runId, "template");
  const admin = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await admin.query(`CREATE DATABASE "${templateDatabase}"`);
  } finally {
    await admin.end();
  }
  // A template must have no open connections when it is copied, so this pool
  // is closed before any file starts.
  const pool = new Pool({
    connectionString: databaseUrlFor(databaseUrl, templateDatabase),
    max: 1,
  });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: path.resolve("src/persistence/postgres-migrations"),
    });
  } finally {
    await pool.end();
  }
  return templateDatabase;
}

export default async function setup(project: TestProject) {
  const resource = await prepareTestPostgres();
  try {
    const templateDatabase = await createTemplate(resource.databaseUrl, resource.runId);
    project.provide("cashierPostgres", {
      databaseUrl: resource.databaseUrl,
      runId: resource.runId,
      templateDatabase,
    });
  } catch (error) {
    await resource.cleanup();
    throw error;
  }

  return async () => {
    await resource.cleanup();
  };
}
