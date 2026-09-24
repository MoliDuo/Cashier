import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { createTestSourceDocument, createTestUserWithLedger } from "../../helpers/schema-setup";
import { entryCategories, ledgerEntries } from "@/persistence";
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
      "fk_ledger_entries_document_ledger",
      "fk_ledger_entries_revision_ledger",
      "fk_ledger_entries_document_revision",
      "fk_ledger_entries_category_ledger",
      "fk_revision_files_revision_ledger",
      "fk_revision_files_stored_file_ledger",
      "fk_processing_outbox_revision_ledger",
      "fk_processing_outbox_document_ledger",
      "fk_upload_session_files_session_ledger",
      "fk_upload_session_files_stored_file_ledger",
      "fk_source_documents_active_revision",
      "fk_source_documents_latest_submission_revision",
    ];
    for (const name of expected) {
      expect(byName.has(name), `missing foreign key ${name}`).toBe(true);
    }

    // The category FK must be ledger-scoped and keep the set-null behavior.
    expect(byName.get("fk_ledger_entries_category_ledger")).toContain(
      "FOREIGN KEY (ledger_id, category_id)"
    );
    expect(byName.get("fk_ledger_entries_category_ledger")).toContain(
      "ON DELETE SET NULL (category_id)"
    );
    // The legacy single-column FK must be gone.
    expect(byName.has("ledger_entries_category_id_entry_categories_id_fk")).toBe(false);
  });

  it("keeps sync version guards", async () => {
    const byName = new Map((await fetchConstraints()).map((row) => [row.conname, row.definition]));

    // 0016 declared these inline, so PostgreSQL auto-named them.
    expect(compact(byName.get("ledger_sync_state_version_check"))).toContain("version>=0");
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
      "trg_source_document_revisions_change_log",
      "trg_ledger_entries_change_log",
      "trg_entry_categories_change_log",
      "trg_ledgers_settings_change_log",
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

  it("keeps the key partial indexes and tenant unique keys", async () => {
    const byName = new Map((await fetchIndexes()).map((row) => [row.indexname, row.indexdef]));
    for (const name of [
      "uq_entry_categories_ledger_id_id",
      "uq_ledger_entries_revision_position",
      "idx_source_documents_active_feed",
      "idx_ledger_entries_active_feed",
      "idx_ledger_entries_active_category",
      "idx_ledger_entries_active_currency",
      "idx_ledger_entries_active_amount",
      "idx_ledger_entries_search",
    ]) {
      expect(byName.has(name), `missing index ${name}`).toBe(true);
    }
    expect(byName.get("idx_source_documents_active_feed")).toContain("effective_date");
    expect(byName.get("idx_ledger_entries_active_amount")).toContain("converted_amount");
    expect(byName.get("idx_ledger_entries_active_amount")).toContain("WHERE");
    expect(byName.get("idx_ledger_entries_search")).toContain("gin");
  });

  it("rejects cross-ledger category assignment with an FK violation", async () => {
    const db = getTestDb();
    const { ledgerId: firstLedger } = await createTestUserWithLedger(db);
    const { ledgerId: secondLedger } = await createTestUserWithLedger(
      db,
      undefined,
      undefined,
      "22222222-2222-4222-8222-222222222222"
    );
    const category = (
      await db
        .insert(entryCategories)
        .values({ ledgerId: firstLedger, name: "Other Ledger" })
        .returning()
    )[0];
    if (category == null) throw new Error("Expected category insert to return a row");

    const sourceDocumentId = await createTestSourceDocument(db, secondLedger);
    await expect(
      db.insert(ledgerEntries).values({
        ledgerId: secondLedger,
        sourceDocumentId,
        categoryId: category.id,
        amount: "1.00",
        currency: "CNY",
        itemName: "Cross-ledger category",
      })
    ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "23503" }) });
  });

  it("has no named constraint or index drift from the Drizzle model", async () => {
    const model = getDrizzleContractNames();
    const constraintRows = await fetchConstraints();
    const databaseConstraints = new Set(
      constraintRows.filter((row) => row.type !== "p").map((row) => row.conname)
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
