import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getTestDb, getTestPool } from "tests/setup";
import { createTestSourceDocument, createTestUserWithLedger } from "tests/helpers/schema-setup";
import { entryCategories, ledgerEntries, ledgers } from "@/persistence";
import * as schema from "@/persistence";
import { getTableConfig, type AnyPgTable } from "drizzle-orm/pg-core";

interface ConstraintRow {
  conname: string;
  definition: string;
  type: "c" | "f" | "p" | "u";
}

interface IndexRow {
  indexname: string;
  indexdef: string;
}

interface TriggerRow {
  tgname: string;
}

interface ColumnRow {
  columnName: string;
  isGenerated: string;
  generationExpression: string | null;
}

async function fetchConstraints(): Promise<ConstraintRow[]> {
  const result = await getTestDb().execute<ConstraintRow & Record<string, unknown>>(sql`
    SELECT con.conname, con.contype AS type, pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    WHERE ns.nspname = current_schema()
      AND con.contype IN ('c', 'f', 'p', 'u')
    ORDER BY con.conname
  `);
  return result.rows;
}

async function fetchIndexes(): Promise<IndexRow[]> {
  const result = await getTestDb().execute<IndexRow & Record<string, unknown>>(sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = current_schema()
    ORDER BY indexname
  `);
  return result.rows;
}

function isPgTable(value: unknown): value is AnyPgTable {
  return (
    typeof value === "object" &&
    value != null &&
    Symbol.for("drizzle:Name") in value &&
    Symbol.for("drizzle:Columns") in value
  );
}

function getDrizzleContractNames() {
  const constraints = new Set<string>();
  const indexes = new Set<string>();

  const tables = Object.values(schema).filter(isPgTable) as AnyPgTable[];
  for (const table of tables) {
    const config = getTableConfig(table);
    for (const foreignKey of config.foreignKeys) constraints.add(foreignKey.getName());
    for (const check of config.checks) constraints.add(check.name);
    for (const uniqueConstraint of config.uniqueConstraints) {
      if (uniqueConstraint.name != null) constraints.add(uniqueConstraint.name);
    }
    for (const column of config.columns) {
      if (column.isUnique && column.uniqueName != null) constraints.add(column.uniqueName);
    }
    for (const tableIndex of config.indexes) {
      if (tableIndex.config.name != null) indexes.add(tableIndex.config.name);
    }
  }

  return { constraints, indexes };
}

async function fetchTriggers(): Promise<TriggerRow[]> {
  const result = await getTestDb().execute<TriggerRow & Record<string, unknown>>(sql`
    SELECT trigger.tgname
    FROM pg_trigger trigger
    JOIN pg_class cls ON cls.oid = trigger.tgrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    WHERE ns.nspname = current_schema()
      AND NOT trigger.tgname LIKE 'pg\\_%'
    ORDER BY trigger.tgname
  `);
  return result.rows;
}

async function fetchColumns(tableName: string): Promise<ColumnRow[]> {
  const result = await getTestDb().execute<ColumnRow & Record<string, unknown>>(sql`
    SELECT column_name AS "columnName",
      is_generated AS "isGenerated",
      generation_expression AS "generationExpression"
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = ${tableName}
    ORDER BY ordinal_position
  `);
  return result.rows;
}

describe("PostgreSQL schema contract", () => {
  const compact = (definition: string | undefined) => definition?.replace(/[\s()]/g, "") ?? "";

  it("keeps every tenant-scoped composite foreign key", async () => {
    const byName = new Map((await fetchConstraints()).map((row) => [row.conname, row.definition]));
    const expected = [
      "fk_ledger_entries_source_document",
      "fk_ledger_entries_category",
      "fk_source_document_files_source_document",
      "fk_source_document_files_stored_file",
      "fk_source_documents_latest_attempt",
      "fk_extraction_attempts_source_document",
    ];
    for (const name of expected) {
      expect(byName.has(name), `missing foreign key ${name}`).toBe(true);
    }

    // The category FK must be ledger-scoped and keep the set-null behavior.
    expect(byName.get("fk_ledger_entries_category")).toContain(
      "FOREIGN KEY (ledger_id, category_id)"
    );
    expect(byName.get("fk_ledger_entries_category")).toContain("ON DELETE SET NULL (category_id)");
    // The legacy single-column FK must be gone.
    expect(byName.has("ledger_entries_category_id_entry_categories_id_fk")).toBe(false);
  });

  it("keeps sync version guards", async () => {
    const byName = new Map((await fetchConstraints()).map((row) => [row.conname, row.definition]));

    expect(compact(byName.get("ck_ledger_sync_state_version"))).toContain("version>=0");
    expect(byName.has("ledger_change_batches_version_check")).toBe(false);
  });

  it("removes status triggers while keeping change-log triggers", async () => {
    const names = new Set((await fetchTriggers()).map((row) => row.tgname));
    for (const name of [
      "trg_source_documents_refresh_status",
      "trg_revisions_refresh_document_status",
    ]) {
      expect(names.has(name), `unexpected trigger ${name}`).toBe(false);
    }
    for (const name of [
      "trg_source_documents_change_log",
      "trg_extraction_attempts_change_log",
      "trg_ledger_entries_change_log",
      "trg_entry_categories_change_log",
      "trg_ledgers_settings_change_log",
      "trg_books_change_log",
      "trg_service_credentials_change_log",
    ]) {
      expect(names.has(name), `missing trigger ${name}`).toBe(true);
    }
  });

  it("keeps only aggregate ledger change-log state", async () => {
    expect(await fetchColumns("ledger_change_batches")).toEqual([]);
    const columns = (await fetchColumns("ledger_sync_state")).map((column) => column.columnName);
    expect(columns).toEqual(
      expect.arrayContaining([
        "version",
        "transaction_id",
        "categories_version",
        "settings_version",
        "stats_version",
      ])
    );
    expect(await fetchColumns("ledger_change_items")).toEqual([]);
  });

  it("keeps effective_date as a generated UTC-fallback column", async () => {
    const effective = (await fetchColumns("source_documents")).find(
      (column) => column.columnName === "effective_date"
    );
    expect(effective).toBeDefined();
    expect(effective?.isGenerated).toBe("ALWAYS");
    expect(effective?.generationExpression ?? "").toContain("document_date");
    expect(effective?.generationExpression ?? "").toContain("created_at");
    expect(effective?.generationExpression ?? "").toContain("UTC");
  });

  it("keeps the key indexes and tenant unique keys", async () => {
    const byName = new Map((await fetchIndexes()).map((row) => [row.indexname, row.indexdef]));
    for (const name of [
      "uq_entry_categories_ledger_id_id",
      "idx_ledger_entries_document_position",
      "idx_source_documents_feed",
      "idx_source_documents_book_feed",
      "idx_extraction_attempts_due",
      "idx_ledger_entries_category",
      "idx_ledger_entries_search",
    ]) {
      expect(byName.has(name), `missing index ${name}`).toBe(true);
    }
    expect(byName.get("idx_source_documents_feed")).toContain("effective_date");
    expect(byName.get("idx_source_documents_book_feed")).toContain("book_id, effective_date");
    expect(byName.get("idx_ledger_entries_search")).toContain("gin");
  });

  it("hard-deletes rows and marks only a credential as revoked", async () => {
    const tables = [
      "source_documents",
      "ledger_entries",
      "entry_categories",
      "stored_files",
      "service_credentials",
    ];
    for (const table of tables) {
      const columns = (await fetchColumns(table)).map((column) => column.columnName);
      expect(columns, table).not.toContain("deleted_at");
    }
    const credentialColumns = (await fetchColumns("service_credentials")).map(
      (column) => column.columnName
    );
    expect(credentialColumns).toContain("revoked_at");
  });

  it("names every constraint and index by one convention", async () => {
    const tables = new Set(
      (
        await getTestDb().execute<{ name: string }>(sql`
          SELECT table_name AS name FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
        `)
      ).rows.map((row) => row.name)
    );
    const ownedBy = (name: string, prefix: string) =>
      [...tables].some((table) => name.startsWith(`${prefix}_${table}_`));
    const misnamed: string[] = [];
    for (const row of await fetchConstraints()) {
      const prefix = { c: "ck", f: "fk", u: "uq", p: null }[row.type];
      if (prefix == null) {
        if (!tables.has(row.conname.replace(/_pkey$/, ""))) misnamed.push(row.conname);
      } else if (!ownedBy(row.conname, prefix)) {
        misnamed.push(row.conname);
      }
    }
    for (const row of await fetchIndexes()) {
      if (row.indexname.endsWith("_pkey")) continue;
      const prefix = row.indexdef.startsWith("CREATE UNIQUE") ? "uq" : "idx";
      if (!ownedBy(row.indexname, prefix)) misnamed.push(row.indexname);
    }
    expect(misnamed).toEqual([]);
  });

  it("keeps entries tied to a document and attempt dates as dates", async () => {
    const columns = await getTestDb().execute<{
      table: string;
      column: string;
      nullable: string;
      type: string;
    }>(sql`
      SELECT table_name AS table, column_name AS column, is_nullable AS nullable, data_type AS type
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND (table_name, column_name) IN (
          ('ledger_entries', 'source_document_id'),
          ('extraction_attempts', 'requested_date'),
          ('extraction_attempts', 'claim_token'),
          ('login_emails', 'verified_at')
        )
      ORDER BY table_name, column_name
    `);
    expect(columns.rows).toEqual([
      { table: "extraction_attempts", column: "claim_token", nullable: "YES", type: "uuid" },
      { table: "extraction_attempts", column: "requested_date", nullable: "YES", type: "date" },
      { table: "ledger_entries", column: "source_document_id", nullable: "NO", type: "uuid" },
      {
        table: "login_emails",
        column: "verified_at",
        nullable: "NO",
        type: "timestamp with time zone",
      },
    ]);
  });

  it("keeps no passwords, auth versions or setup state", async () => {
    const userColumns = (await fetchColumns("users")).map((column) => column.columnName);
    expect(userColumns.sort()).toEqual(["created_at", "id", "updated_at"]);
    expect(await fetchColumns("setup_state")).toEqual([]);
  });

  it("checks category names per ledger when a statement ends", async () => {
    const result = await getTestDb().execute<{ definition: string; deferrable: boolean }>(sql`
      SELECT pg_get_constraintdef(oid) AS definition, condeferrable AS deferrable
      FROM pg_constraint
      WHERE conname = 'uq_entry_categories_ledger_name'
        AND connamespace = current_schema()::regnamespace
    `);
    expect(result.rows).toEqual([
      {
        definition: "UNIQUE (ledger_id, name) DEFERRABLE",
        deferrable: true,
      },
    ]);
  });

  it("keeps a single ledger", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);
    await expect(db.insert(ledgers).values({})).rejects.toMatchObject({
      cause: expect.objectContaining({ code: "23505", constraint: "uq_ledgers_singleton" }),
    });
  });

  it("fills the retired ledger_id from the one ledger, so the tenant keys still hold", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);
    const [category] = await db.insert(entryCategories).values({ name: "Food" }).returning();
    const sourceDocumentId = await createTestSourceDocument(db);
    await db.insert(ledgerEntries).values({
      sourceDocumentId,
      categoryId: category!.id,
      amount: "1.00",
      currency: "CNY",
      itemName: "Noodles",
    });

    const unfilled = await db.execute<{ table_name: string }>(sql`
      SELECT 'books' AS table_name FROM books WHERE ledger_id IS DISTINCT FROM current_ledger_id()
      UNION ALL SELECT 'entry_categories' FROM entry_categories
        WHERE ledger_id IS DISTINCT FROM current_ledger_id()
      UNION ALL SELECT 'source_documents' FROM source_documents
        WHERE ledger_id IS DISTINCT FROM current_ledger_id()
      UNION ALL SELECT 'extraction_attempts' FROM extraction_attempts
        WHERE ledger_id IS DISTINCT FROM current_ledger_id()
      UNION ALL SELECT 'ledger_entries' FROM ledger_entries
        WHERE ledger_id IS DISTINCT FROM current_ledger_id()
    `);
    expect(unfilled.rows).toEqual([]);
  });

  it("refuses to migrate a database that holds more than one ledger", async () => {
    const migration = readFileSync(
      "src/persistence/postgres-migrations/0023_ledger_singleton.sql",
      "utf8"
    );
    const guard = migration.split("--> statement-breakpoint")[0]!;
    const client = await getTestPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("DROP INDEX uq_ledgers_singleton");
      await client.query("INSERT INTO ledgers DEFAULT VALUES");
      await client.query("INSERT INTO ledgers DEFAULT VALUES");
      await expect(client.query(guard)).rejects.toThrow(
        "Cashier expects at most one ledger, found 2"
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("has no named constraint or index drift from the Drizzle model", async () => {
    // Names a later contract migration drops once the model has let go of
    // them: the keys and indexes built on `ledger_id`, which 0024 drops or
    // rebuilds without it.
    const retiredNames = new Set<string>([
      "fk_books_ledger",
      "uq_books_ledger_id_id",
      "idx_books_active_sort",
      "uq_books_active_name",
      "fk_entry_categories_ledger",
      "uq_entry_categories_ledger_id_id",
      "idx_entry_categories_sort",
      "uq_entry_categories_ledger_name",
      "fk_ledger_entries_ledger",
      "fk_ledger_entries_category",
      "fk_ledger_entries_source_document",
      "idx_ledger_entries_category",
      "idx_ledger_entries_document_position",
      "fk_service_credentials_ledger",
      "fk_service_credentials_book",
      "idx_service_credentials_ledger_book",
      "fk_source_documents_ledger",
      "fk_source_documents_book",
      "fk_source_documents_latest_attempt",
      "uq_source_documents_ledger_id_id",
      "uq_source_documents_idempotency",
      "idx_source_documents_feed",
      "idx_source_documents_book_feed",
      "fk_extraction_attempts_source_document",
      "uq_extraction_attempts_ledger_document_id",
      "idx_extraction_attempts_due",
      "fk_stored_files_ledger",
      "uq_stored_files_ledger_id_id",
      "fk_source_document_files_source_document",
      "fk_source_document_files_stored_file",
      "idx_source_document_files_ledger_file",
      "fk_category_assignment_jobs_ledger",
      "uq_category_assignment_jobs_request_key",
      "uq_category_assignment_jobs_active",
      "fk_category_assignment_documents_ledger",
      "idx_category_assignment_documents_ledger_job",
      "fk_category_assignment_entries_ledger",
      "idx_category_assignment_entries_ledger_job",
      "fk_ledger_sync_state_ledger",
    ]);
    const model = getDrizzleContractNames();
    const constraintRows = await fetchConstraints();
    const databaseConstraints = new Set(
      constraintRows
        .filter((row) => row.type !== "p")
        .map((row) => row.conname)
        .filter((name) => !retiredNames.has(name))
    );
    const constraintBackedIndexes = new Set(
      constraintRows.filter((row) => row.type === "p" || row.type === "u").map((row) => row.conname)
    );
    const databaseIndexes = new Set(
      (await fetchIndexes())
        .map((row) => row.indexname)
        // Primary keys are modeled as columns rather than named table config.
        .filter((name) => !name.endsWith("_pkey"))
        // PostgreSQL exposes UNIQUE constraints as both constraints and backing indexes.
        .filter((name) => !constraintBackedIndexes.has(name))
        .filter((name) => !retiredNames.has(name))
    );

    expect({
      missingFromDatabase: [...model.constraints].filter((name) => !databaseConstraints.has(name)),
      missingFromModel: [...databaseConstraints].filter((name) => !model.constraints.has(name)),
    }).toEqual({ missingFromDatabase: [], missingFromModel: [] });
    expect({
      missingFromDatabase: [...model.indexes].filter((name) => !databaseIndexes.has(name)),
      missingFromModel: [...databaseIndexes].filter((name) => !model.indexes.has(name)),
    }).toEqual({ missingFromDatabase: [], missingFromModel: [] });
  });
});
