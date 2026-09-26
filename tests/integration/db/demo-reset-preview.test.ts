import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { inspectDemoResetTargets, previewDemoReset } from "../../../scripts/demo-data.mjs";
import { getTestMigrationsSchemaName, getTestPool, getTestSchemaName } from "../../setup";

/**
 * Anything that changes a database: a preview that ran one of these would be a
 * rebuild wearing a preview label.
 */
const WRITES = /\b(DROP|CREATE|TRUNCATE|DELETE|INSERT|UPDATE|ALTER|GRANT|VACUUM|REINDEX)\b/i;

const DATA_TABLES = [
  "users",
  "ledgers",
  "source_documents",
  "ledger_entries",
  "stored_files",
] as const;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function randomSuffix(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

/** Records every statement the preview sends, then runs it on the real client. */
function recordStatements(client: PoolClient) {
  const statements: string[] = [];
  const query = client.query.bind(client) as unknown as (
    sql: string,
    values?: unknown[]
  ) => Promise<{ rows: unknown[] }>;
  return {
    statements,
    previewClient: {
      query: (sql: string, values?: unknown[]) => {
        statements.push(sql);
        return query(sql, values);
      },
    },
  };
}

/**
 * The tables 0047 left behind, reduced to their old columns: a preview of a
 * database a previous release wrote must not read a column that release never
 * created, so this fixture deliberately omits every current business column.
 */
async function createLegacySchema(
  client: PoolClient,
  dataSchema: string,
  migrationsSchema: string
) {
  await client.query(`
    CREATE TABLE ${quoteIdentifier(dataSchema)}.users (
      id uuid PRIMARY KEY,
      email text NOT NULL,
      nickname text NOT NULL,
      gender text NOT NULL,
      password_hash text
    );
    CREATE TABLE ${quoteIdentifier(dataSchema)}.ledgers (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES ${quoteIdentifier(dataSchema)}.users(id) ON DELETE cascade
    );
    CREATE TABLE ${quoteIdentifier(migrationsSchema)}."__drizzle_migrations" (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    );
  `);
}

/** Creates a throwaway schema pair, hands it to the body, then drops it. */
async function withSchemas(
  body: (context: { dataSchema: string; migrationsSchema: string }) => Promise<void>
) {
  const admin = await getTestPool().connect();
  const dataSchema = `demo_preview_${randomSuffix()}`;
  const migrationsSchema = `${dataSchema}_migrations`;
  try {
    await admin.query(`CREATE SCHEMA "${dataSchema}"`);
    await admin.query(`CREATE SCHEMA "${migrationsSchema}"`);
    await body({ dataSchema, migrationsSchema });
  } finally {
    await admin.query(`DROP SCHEMA IF EXISTS "${dataSchema}" CASCADE`).catch(() => undefined);
    await admin.query(`DROP SCHEMA IF EXISTS "${migrationsSchema}" CASCADE`).catch(() => undefined);
    admin.release();
  }
}

async function countRows(client: PoolClient, schema: string, table: string): Promise<number> {
  const result = await client.query(`SELECT count(*)::int AS count FROM "${schema}"."${table}"`);
  return (result.rows[0] as { count: number }).count;
}

describe("demo reset preview against a real database", () => {
  it("counts the tables of the migrated schema and leaves them alone", async () => {
    const client = await getTestPool().connect();
    try {
      // The file's database is a real migrated copy, so every counted table
      // exists and its count is a count a rebuild would replace.
      const { previewClient, statements } = recordStatements(client);
      const migrationsSchema = getTestMigrationsSchemaName();
      const result = await inspectDemoResetTargets(previewClient, {
        dataSchema: getTestSchemaName(),
        migrationsSchema,
      });

      const schema = result.schemas[getTestSchemaName()]!;
      expect(schema.exists).toBe(true);
      for (const table of DATA_TABLES) expect(schema.tables).toContain(table);
      // Only the seeded account exists at this point in the suite.
      expect(schema.rows).toMatchObject({
        users: 1,
        ledgers: 0,
        source_documents: 0,
        ledger_entries: 0,
        stored_files: 0,
      });

      // The bookkeeping schema is whatever Drizzle created there: the preview
      // reads its table list rather than assuming a name or a shape.
      const migrations = result.schemas[migrationsSchema]!;
      expect(migrations.exists).toBe(true);
      expect(migrations.rows["__drizzle_migrations"]).toBe(
        await countRows(client, migrationsSchema, "__drizzle_migrations")
      );

      expect(statements).toContain("BEGIN READ ONLY");
      expect(statements).toContain("COMMIT");
      expect(statements.filter((sql) => WRITES.test(sql))).toEqual([]);
    } finally {
      client.release();
    }
  });

  it("describes a database an earlier release left behind", async () => {
    await withSchemas(async ({ dataSchema, migrationsSchema }) => {
      const setup = await getTestPool().connect();
      try {
        await createLegacySchema(setup, dataSchema, migrationsSchema);
        await setup.query(`
          INSERT INTO "${dataSchema}".users (id, email, nickname, gender)
          VALUES (gen_random_uuid(), 'a@example.com', 'a', 'male'),
                 (gen_random_uuid(), 'b@example.com', 'b', 'female'),
                 (gen_random_uuid(), 'c@example.com', 'c', 'female')
        `);
        await setup.query(`
          INSERT INTO "${migrationsSchema}"."__drizzle_migrations" (hash, created_at)
          SELECT md5(n::text), n FROM generate_series(1, 7) AS n
        `);

        const { previewClient, statements } = recordStatements(setup);
        const result = await inspectDemoResetTargets(previewClient, {
          dataSchema,
          migrationsSchema,
        });

        // The tables the legacy release never created are named as absent
        // rather than counted, and no column beyond a name is ever read.
        expect(result.schemas[dataSchema]).toEqual({
          exists: true,
          tables: ["ledgers", "users"],
          rows: {
            users: 3,
            ledgers: 0,
            source_documents: null,
            ledger_entries: null,
            stored_files: null,
          },
        });
        expect(result.schemas[migrationsSchema]).toEqual({
          exists: true,
          tables: ["__drizzle_migrations"],
          rows: { __drizzle_migrations: 7 },
        });
        expect(statements).toContain("BEGIN READ ONLY");
        expect(statements.filter((sql) => WRITES.test(sql))).toEqual([]);

        // Read-only in effect as well as in intent: the legacy rows and the
        // migration log are exactly what the fixture wrote.
        expect(await countRows(setup, dataSchema, "users")).toBe(3);
        expect(await countRows(setup, migrationsSchema, "__drizzle_migrations")).toBe(7);
      } finally {
        setup.release();
      }
    });
  });

  it("reports an empty database as absent targets and creates nothing", async () => {
    const client = await getTestPool().connect();
    const missing = `demo_preview_missing_${randomSuffix()}`;
    try {
      const { previewClient, statements } = recordStatements(client);
      const result = await inspectDemoResetTargets(previewClient, {
        dataSchema: missing,
        migrationsSchema: `${missing}_migrations`,
      });

      expect(result.schemas[missing]).toEqual({
        exists: false,
        tables: [],
        rows: Object.fromEntries(DATA_TABLES.map((table) => [table, null])),
      });
      expect(result.schemas[`${missing}_migrations`]).toEqual({
        exists: false,
        tables: [],
        rows: {},
      });
      expect(statements.filter((sql) => WRITES.test(sql))).toEqual([]);

      const created = await client.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [
        missing,
      ]);
      expect(created.rows).toHaveLength(0);
    } finally {
      client.release();
    }
  });

  it("refuses a database that is not the dedicated demo one", async () => {
    // Two independent refusals, both raised before a connection exists, so a
    // preview can never rebuild the wrong database as a consolation prize: a
    // run that is not in demo mode, and a demo run pointed at any other
    // database. The test database is a real loopback server, and the guard
    // still refuses it because the database name is what decides.
    expect(process.env.DATABASE_URL).toMatch(/@(127[.]0[.]0[.]1|localhost|[[][:][:]1[]]):/);

    await expect(previewDemoReset({ ...process.env })).rejects.toThrow(/CASHIER_DEMO_MODE/);
    await expect(previewDemoReset({ ...process.env, CASHIER_DEMO_MODE: "true" })).rejects.toThrow(
      /cashier_demo/
    );
    expect(process.env.DATABASE_URL).not.toContain("/cashier_demo");
  });
});
