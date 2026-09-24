/**
 * Compatibility contract: upgrading the real pre-0048 database.
 *
 * `books-single-account-migration.test.ts` next door pins 0048's guards and data
 * rules against a reduced, hand-written pre-migration schema. This test covers
 * what that one cannot: it replays the published migration chain 0000 -> 0047
 * through the same Drizzle migrator `npm run db:migrate` uses, seeds fully
 * synthetic couple data into the result, and then applies the real 0048 and
 * 0049 from the published directory. A change to an earlier migration, or a
 * 0048 that only works on the reduced fixture, fails here.
 *
 * Isolation: one dedicated schema pair owned by this test
 * (`<worker schema>_u<random>` plus its `<schema>_migrations` bookkeeping
 * schema), one dedicated connection pool, and one temporary migration
 * directory holding the published journal truncated after 0047 together with
 * byte-identical copies of its SQL files. Nothing outside those is created,
 * read, changed, or dropped.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { getTestPool, getTestSchemaName } from "../../setup";

const MIGRATIONS_DIRECTORY = path.resolve("src/persistence/postgres-migrations");
/** The last published migration before the single-account rework. */
const LEGACY_BOUNDARY_TAG = "0047_member_profiles";
const OWNER_EMAIL = "xiangyu.moe.ac@gmail.com";
const PARTNER_EMAIL = "liangyilinhuaxue@163.com";
/**
 * The fixture writes documents, revisions, a revision-pointer update, entries
 * and categories as five separate statements, and the 0032 change-log trigger
 * records one version per transaction that touches those tables.
 */
const FIXTURE_SYNC_VERSION = 5;

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface MigrationJournal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

interface MigrationLogRow {
  hash: string;
  created_at: string;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function firstRow<T>(rows: T[], message: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(message);
  return row;
}

function sha256File(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url == null || url === "") {
    throw new Error("DATABASE_URL is not set; run this test in the integration project");
  }
  return url;
}

function readPublishedJournal(): MigrationJournal {
  return JSON.parse(
    readFileSync(path.join(MIGRATIONS_DIRECTORY, "meta", "_journal.json"), "utf8")
  ) as MigrationJournal;
}

/**
 * The journal up to 0047 plus copies of its SQL files, in a directory this test
 * removes again. `copyFileSync` keeps the bytes identical: the migrator hashes
 * the file it replays, so the chain below is the published one and every hash it
 * records is the published file's hash.
 */
function createLegacyMigrationFolder(): { directory: string; entries: JournalEntry[] } {
  const journal = readPublishedJournal();
  const boundary = journal.entries.findIndex((entry) => entry.tag === LEGACY_BOUNDARY_TAG);
  if (boundary < 0) {
    throw new Error(`The published journal no longer contains ${LEGACY_BOUNDARY_TAG}`);
  }
  const entries = journal.entries.slice(0, boundary + 1);
  const directory = mkdtempSync(path.join(tmpdir(), "cashier-0047-chain-"));
  try {
    mkdirSync(path.join(directory, "meta"));
    for (const entry of entries) {
      copyFileSync(
        path.join(MIGRATIONS_DIRECTORY, `${entry.tag}.sql`),
        path.join(directory, `${entry.tag}.sql`)
      );
    }
    writeFileSync(
      path.join(directory, "meta", "_journal.json"),
      `${JSON.stringify(
        { version: journal.version, dialect: journal.dialect, entries },
        null,
        2
      )}\n`
    );
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return { directory, entries };
}

/**
 * A schema pair this test owns, derived from the worker schema so it keeps the
 * run's `test_<run id>_` prefix the test runner cleans up.
 */
function deriveSchemaPair(): { dataSchema: string; migrationsSchema: string } {
  const suffix = `_u${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const base = getTestSchemaName().slice(0, 63 - suffix.length - "_migrations".length);
  const dataSchema = `${base}${suffix}`;
  return { dataSchema, migrationsSchema: `${dataSchema}_migrations` };
}

/** The migrator call `scripts/migrate-database.mjs` makes for a named schema. */
async function runMigrations(
  pool: Pool,
  migrationsFolder: string,
  migrationsSchema: string
): Promise<void> {
  await migrate(drizzle(pool), { migrationsFolder, migrationsSchema });
}

async function fetchMigrationLog(
  pool: Pool,
  migrationsSchema: string
): Promise<Array<{ hash: string; when: number }>> {
  const result = await pool.query<MigrationLogRow>(
    `SELECT hash, created_at FROM ${quoteIdentifier(migrationsSchema)}."__drizzle_migrations"
      ORDER BY created_at, id`
  );
  return result.rows.map((row) => ({ hash: row.hash, when: Number(row.created_at) }));
}

/** What the migrator must have recorded for `entries`, in `when` order. */
function publishedMigrationLog(entries: JournalEntry[]): Array<{ hash: string; when: number }> {
  return [...entries]
    .sort((left, right) => left.when - right.when)
    .map((entry) => ({
      hash: sha256File(path.join(MIGRATIONS_DIRECTORY, `${entry.tag}.sql`)),
      when: entry.when,
    }));
}

async function tableExists(pool: Pool, table: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = $1`,
    [table]
  );
  return result.rows.length > 0;
}

async function columnNames(pool: Pool, table: string): Promise<string[]> {
  const result = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1
      ORDER BY column_name`,
    [table]
  );
  return result.rows.map((row) => row.column_name);
}

async function constraintDefinitions(pool: Pool): Promise<Map<string, string>> {
  const result = await pool.query<{ name: string; definition: string }>(
    `SELECT con.conname AS name, pg_get_constraintdef(con.oid) AS definition
       FROM pg_constraint con
       JOIN pg_class cls ON cls.oid = con.conrelid
       JOIN pg_namespace ns ON ns.oid = cls.relnamespace
      WHERE ns.nspname = current_schema()
      ORDER BY con.conname`
  );
  return new Map(result.rows.map((row) => [row.name, row.definition]));
}

async function indexDefinitions(pool: Pool): Promise<Map<string, string>> {
  const result = await pool.query<{ indexname: string; indexdef: string }>(
    `SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = current_schema()
      ORDER BY indexname`
  );
  return new Map(result.rows.map((row) => [row.indexname, row.indexdef]));
}

/**
 * Every table, column, constraint, index and trigger of the test schema in a
 * stable order: what a repeated migration must leave byte-for-byte the same.
 */
async function schemaFingerprint(pool: Pool): Promise<string> {
  const columns = await pool.query<Record<string, unknown>>(
    `SELECT cls.relname AS table_name, attribute.attname AS column_name,
            format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
            attribute.attnotnull AS not_null,
            pg_get_expr(definition.adbin, definition.adrelid) AS default_expression
       FROM pg_attribute attribute
       JOIN pg_class cls ON cls.oid = attribute.attrelid
       JOIN pg_namespace ns ON ns.oid = cls.relnamespace
       LEFT JOIN pg_attrdef definition
         ON definition.adrelid = cls.oid AND definition.adnum = attribute.attnum
      WHERE ns.nspname = current_schema()
        AND cls.relkind IN ('r', 'p')
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
      ORDER BY cls.relname, attribute.attname`
  );
  const constraints = await pool.query<Record<string, unknown>>(
    `SELECT cls.relname AS table_name, con.conname AS constraint_name,
            pg_get_constraintdef(con.oid) AS definition
       FROM pg_constraint con
       JOIN pg_class cls ON cls.oid = con.conrelid
       JOIN pg_namespace ns ON ns.oid = cls.relnamespace
      WHERE ns.nspname = current_schema()
      ORDER BY cls.relname, con.conname`
  );
  const indexes = await pool.query<Record<string, unknown>>(
    `SELECT tablename AS table_name, indexname AS index_name, indexdef AS definition
       FROM pg_indexes WHERE schemaname = current_schema()
      ORDER BY tablename, indexname`
  );
  const triggers = await pool.query<Record<string, unknown>>(
    `SELECT cls.relname AS table_name, trigger.tgname AS trigger_name
       FROM pg_trigger trigger
       JOIN pg_class cls ON cls.oid = trigger.tgrelid
       JOIN pg_namespace ns ON ns.oid = cls.relnamespace
      WHERE ns.nspname = current_schema() AND NOT trigger.tgname LIKE 'pg\\_%'
      ORDER BY cls.relname, trigger.tgname`
  );
  return JSON.stringify([columns.rows, constraints.rows, indexes.rows, triggers.rows]);
}

async function scalarCount(pool: Pool, text: string, values: unknown[] = []): Promise<number> {
  const result = await pool.query<{ count: number }>(text, values);
  return Number(firstRow(result.rows, `Expected a count row from: ${text}`).count);
}

interface LegacyFixture {
  ownerId: string;
  partnerId: string;
  retiredId: string;
  liveLedgerId: string;
  historicalLedgerId: string;
  liveCategoryId: string;
  retiredCategoryId: string;
  partnerChallengeId: string;
  ownerChallengeId: string;
  ownerActiveDocumentId: string;
  ownerDeletedDocumentId: string;
  partnerActiveDocumentId: string;
  partnerProcessingDocumentId: string;
  ownerSubmissionRevisionId: string;
  ownerEditRevisionId: string;
  ownerDeletedRevisionId: string;
  partnerActiveRevisionId: string;
  partnerProcessingRevisionId: string;
  ownerEntryId: string;
  usdEntryId: string;
  deletedEntryId: string;
  partnerEntryId: string;
  ownerFileId: string;
  partnerFileId: string;
  retiredFileId: string;
  ownerFileLinkId: string;
  partnerFileLinkId: string;
  retiredFileLinkId: string;
  ownerCredentialId: string;
  partnerCredentialId: string;
  retiredCredentialId: string;
}

interface LegacyUserRow {
  id: string;
  name: string | null;
  nickname: string;
  gender: string;
  time_zone: string | null;
  email: string;
  email_verified: string | null;
  password_hash: string | null;
  auth_version: number;
  preferences: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface UpgradedUserRow {
  id: string;
  name: string | null;
  password_hash: string | null;
  auth_version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface LoginEmailRow {
  id: string;
  user_id: string;
  email: string;
  email_verified: string | null;
  created_at: string;
  updated_at: string;
}

interface LedgerRow {
  id: string;
  user_id: string;
  ai_language: string;
  preferred_currencies: string;
  main_currency: string;
  collapse_entries_default: boolean;
  ai_custom_prompt: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface BookRow {
  id: string;
  ledger_id: string;
  name: string;
  time_zone: string | null;
  sort_order: number;
  archived_at: string | null;
}

interface SyncStateRow {
  ledger_id: string;
  version: string;
  updated_at: string;
}

/**
 * Writes the couple database 0048 was written for: two members with their login
 * and password columns, one live ledger, one historical soft-deleted ledger,
 * records attributed to each person (including records the other person typed
 * in), keys, soft-deleted rows, pending email changes and the sync state the
 * change-log triggers build while seeding.
 */
async function seedLegacyCouple(pool: Pool): Promise<LegacyFixture> {
  const fixture: LegacyFixture = {
    ownerId: crypto.randomUUID(),
    partnerId: crypto.randomUUID(),
    retiredId: crypto.randomUUID(),
    liveLedgerId: crypto.randomUUID(),
    historicalLedgerId: crypto.randomUUID(),
    liveCategoryId: crypto.randomUUID(),
    retiredCategoryId: crypto.randomUUID(),
    partnerChallengeId: crypto.randomUUID(),
    ownerChallengeId: crypto.randomUUID(),
    ownerActiveDocumentId: crypto.randomUUID(),
    ownerDeletedDocumentId: crypto.randomUUID(),
    partnerActiveDocumentId: crypto.randomUUID(),
    partnerProcessingDocumentId: crypto.randomUUID(),
    ownerSubmissionRevisionId: crypto.randomUUID(),
    ownerEditRevisionId: crypto.randomUUID(),
    ownerDeletedRevisionId: crypto.randomUUID(),
    partnerActiveRevisionId: crypto.randomUUID(),
    partnerProcessingRevisionId: crypto.randomUUID(),
    ownerEntryId: crypto.randomUUID(),
    usdEntryId: crypto.randomUUID(),
    deletedEntryId: crypto.randomUUID(),
    partnerEntryId: crypto.randomUUID(),
    ownerFileId: crypto.randomUUID(),
    partnerFileId: crypto.randomUUID(),
    retiredFileId: crypto.randomUUID(),
    ownerFileLinkId: crypto.randomUUID(),
    partnerFileLinkId: crypto.randomUUID(),
    retiredFileLinkId: crypto.randomUUID(),
    ownerCredentialId: crypto.randomUUID(),
    partnerCredentialId: crypto.randomUUID(),
    retiredCredentialId: crypto.randomUUID(),
  };

  // Two live members plus one account the couple already retired: 0048 deletes
  // the second member's row and must leave the retired one alone.
  await pool.query(
    `INSERT INTO users (id, name, nickname, gender, time_zone, email, email_verified,
                        password_hash, password_updated_at, auth_version, created_at, updated_at,
                        deleted_at)
     VALUES
       ($1, 'Fixture Owner', '哞哞', 'male', 'Asia/Kuala_Lumpur', $2, '2026-01-02T03:04:05Z',
        'fixture-owner-password-hash', '2026-01-02T03:04:05Z', 3, '2026-01-01T00:00:00Z',
        '2026-06-01T00:00:00Z', NULL),
       ($3, 'Fixture Partner', '梁梁', 'female', 'Asia/Shanghai', $4, '2026-02-03T04:05:06Z',
        'fixture-partner-password-hash', '2026-02-03T04:05:06Z', 7, '2026-02-01T00:00:00Z',
        '2026-06-02T00:00:00Z', NULL),
       ($5, 'Fixture Retired', '阿宝', 'female', 'Asia/Tokyo', 'fixture-retired@example.com', NULL,
        'fixture-retired-password-hash', NULL, 1, '2025-12-01T00:00:00Z', '2025-12-02T00:00:00Z',
        '2026-05-05T00:00:00Z')`,
    [fixture.ownerId, OWNER_EMAIL, fixture.partnerId, PARTNER_EMAIL, fixture.retiredId]
  );
  await pool.query(
    `INSERT INTO ledgers (id, user_id, ai_language, preferred_currencies, main_currency,
                          collapse_entries_default, ai_custom_prompt, created_at, updated_at,
                          deleted_at)
     VALUES
       ($1, $2, 'zh-CN', ARRAY['CNY', 'USD']::varchar(3)[], 'CNY', false, 'fixture prompt',
        '2026-01-01T00:00:00Z', '2026-06-03T00:00:00Z', NULL),
       ($3, $4, 'zh-CN', ARRAY[]::varchar(3)[], 'CNY', false, '', '2026-02-01T00:00:00Z',
        '2026-06-04T00:00:00Z', '2026-06-05T00:00:00Z')`,
    [fixture.liveLedgerId, fixture.ownerId, fixture.historicalLedgerId, fixture.partnerId]
  );
  await pool.query(
    `INSERT INTO email_change_challenges (id, user_id, new_email, token_hash, expires_at, attempts,
                                          created_at)
     VALUES
       ($1, $2, 'fixture-partner-pending@example.com', 'fixture-partner-challenge-hash',
        '2026-07-01T00:00:00Z', 2, '2026-06-28T00:00:00Z'),
       ($3, $4, 'fixture-owner-pending@example.com', 'fixture-owner-challenge-hash',
        '2026-07-02T00:00:00Z', 0, '2026-06-29T00:00:00Z')`,
    [fixture.partnerChallengeId, fixture.partnerId, fixture.ownerChallengeId, fixture.ownerId]
  );
  await pool.query(
    `INSERT INTO entry_categories (id, ledger_id, name, description, icon, sort_order, created_at,
                                   updated_at, deleted_at)
     VALUES
       ($1, $3, '餐饮', 'fixture category', 'utensils', 1, '2026-01-05T00:00:00Z',
        '2026-01-05T00:00:00Z', NULL),
       ($2, $3, '旧分类', NULL, NULL, 2, '2026-01-06T00:00:00Z', '2026-01-06T00:00:00Z',
        '2026-06-06T00:00:00Z')`,
    [fixture.liveCategoryId, fixture.retiredCategoryId, fixture.liveLedgerId]
  );
  await pool.query(
    `INSERT INTO source_documents (id, ledger_id, attributed_user_id, created_by_user_id, title,
                                   document_date, version, date_organization_suggestion, created_at,
                                   updated_at, deleted_at)
     VALUES
       ($1, $4, $2, $3, 'Owner receipt', '2026-03-01', 4, NULL, '2026-03-01T01:02:03Z',
        '2026-03-02T01:02:03Z', NULL),
       ($5, $4, $2, $2, 'Owner withdrawn note', NULL, 2, NULL, '2026-03-03T01:02:03Z',
        '2026-03-04T01:02:03Z', '2026-03-05T01:02:03Z'),
       ($6, $4, $3, $3, 'Partner receipt', '2026-02-14', 1, NULL, '2026-02-14T01:02:03Z',
        '2026-02-14T02:02:03Z', NULL),
       ($7, $4, $3, $2, 'Partner processing note', '2026-04-01', 1,
        '{"suggestedDate":"2026-04-01"}'::jsonb, '2026-04-01T01:02:03Z', '2026-04-01T01:02:03Z',
        NULL)`,
    [
      fixture.ownerActiveDocumentId,
      fixture.ownerId,
      fixture.partnerId,
      fixture.liveLedgerId,
      fixture.ownerDeletedDocumentId,
      fixture.partnerActiveDocumentId,
      fixture.partnerProcessingDocumentId,
    ]
  );
  // The pointers are set after the rows exist: the composite keys that bind them
  // to the same ledger and document need the revision first.
  await pool.query(
    `INSERT INTO source_document_revisions (id, ledger_id, source_document_id, revision_number,
                                            title, origin, input_text, input_document_date,
                                            input_date_reference, processing_status, failure_kind,
                                            failure_code, failure_message, submitted_at, finished_at,
                                            created_at)
     VALUES
       ($1, $6, $2, 1, 'Owner receipt', 'submission', 'fixture submission text', '2026-03-01', NULL,
        'completed', NULL, NULL, NULL, '2026-03-01T01:03:00Z', '2026-03-01T01:04:00Z',
        '2026-03-01T01:03:00Z'),
       ($3, $6, $2, 2, 'Owner receipt edited', 'manual_edit', 'fixture edited text', NULL, NULL,
        'completed', NULL, NULL, NULL, '2026-03-02T01:03:00Z', '2026-03-02T01:04:00Z',
        '2026-03-02T01:03:00Z'),
       ($4, $6, $5, 1, 'Owner withdrawn note', 'submission', 'fixture withdrawn text', NULL, NULL,
        'failed', 'invalid_input', 'fixture_code', 'fixture failure message', '2026-03-03T01:03:00Z',
        '2026-03-03T01:04:00Z', '2026-03-03T01:03:00Z'),
       ($7, $6, $8, 1, 'Partner receipt', 'manual_entry', 'fixture partner text', '2026-02-14',
        '2026-02-15', 'completed', NULL, NULL, NULL, '2026-02-14T01:03:00Z', '2026-02-14T01:04:00Z',
        '2026-02-14T01:03:00Z'),
       ($9, $6, $10, 1, 'Partner processing note', 'submission', 'fixture processing text',
        '2026-04-01', NULL, 'processing', NULL, NULL, NULL, '2026-04-01T01:03:00Z', NULL,
        '2026-04-01T01:03:00Z')`,
    [
      fixture.ownerSubmissionRevisionId,
      fixture.ownerActiveDocumentId,
      fixture.ownerEditRevisionId,
      fixture.ownerDeletedRevisionId,
      fixture.ownerDeletedDocumentId,
      fixture.liveLedgerId,
      fixture.partnerActiveRevisionId,
      fixture.partnerActiveDocumentId,
      fixture.partnerProcessingRevisionId,
      fixture.partnerProcessingDocumentId,
    ]
  );
  await pool.query(
    `UPDATE source_documents AS document
        SET active_revision_id = pointer.active_revision_id,
            latest_submission_revision_id = pointer.latest_submission_revision_id
       FROM (VALUES
         ($1::uuid, $2::uuid, $3::uuid),
         ($4::uuid, NULL::uuid, $5::uuid),
         ($6::uuid, $7::uuid, $7::uuid),
         ($8::uuid, NULL::uuid, $9::uuid)
       ) AS pointer(document_id, active_revision_id, latest_submission_revision_id)
      WHERE document.id = pointer.document_id`,
    [
      fixture.ownerActiveDocumentId,
      fixture.ownerEditRevisionId,
      fixture.ownerSubmissionRevisionId,
      fixture.ownerDeletedDocumentId,
      fixture.ownerDeletedRevisionId,
      fixture.partnerActiveDocumentId,
      fixture.partnerActiveRevisionId,
      fixture.partnerProcessingDocumentId,
      fixture.partnerProcessingRevisionId,
    ]
  );
  await pool.query(
    `INSERT INTO ledger_entries (id, ledger_id, category_id, source_document_id,
                                 source_document_revision_id, position, amount, currency, item_name,
                                 description, converted_amount, exchange_rate, created_at, updated_at,
                                 deleted_at)
     VALUES
       ($1, $5, $4, $2, $3, 0, 128.500, 'CNY', 'Fixture groceries', 'fixture entry', 128.500,
        1.000000000000, '2026-03-01T02:00:00Z', '2026-03-01T02:00:00Z', NULL),
       ($6, $5, NULL, $2, $3, 1, 42.000, 'USD', 'Fixture book', NULL, 300.000, 7.142857142857,
        '2026-03-01T02:05:00Z', '2026-03-01T02:05:00Z', NULL),
       ($7, $5, $4, $8, $9, 0, 7.000, 'CNY', 'Fixture withdrawn', NULL, NULL, NULL,
        '2026-03-03T02:00:00Z', '2026-03-03T02:00:00Z', '2026-03-06T02:00:00Z'),
       ($10, $5, NULL, $11, $12, 0, 2100.000, 'CNY', 'Fixture deposit', 'fixture entry', 2100.000,
        1.000000000000, '2026-02-14T02:00:00Z', '2026-02-14T02:00:00Z', NULL)`,
    [
      fixture.ownerEntryId,
      fixture.ownerActiveDocumentId,
      fixture.ownerEditRevisionId,
      fixture.liveCategoryId,
      fixture.liveLedgerId,
      fixture.usdEntryId,
      fixture.deletedEntryId,
      fixture.ownerDeletedDocumentId,
      fixture.ownerDeletedRevisionId,
      fixture.partnerEntryId,
      fixture.partnerActiveDocumentId,
      fixture.partnerActiveRevisionId,
    ]
  );
  await pool.query(
    `INSERT INTO stored_files (id, ledger_id, storage_provider, storage_key, content_type, byte_size,
                               original_filename, checksum, created_at, finalized_at, deleted_at)
     VALUES
       ($1, $4, 'local', 'fixtures/legacy/owner-receipt.jpg', 'image/jpeg', 2048,
        'owner-receipt.jpg', 'fixture-checksum-owner', '2026-03-01T01:02:30Z', '2026-03-01T01:02:40Z',
        NULL),
       ($2, $4, 'local', 'fixtures/legacy/partner-receipt.jpg', 'image/jpeg', 4096,
        'partner-receipt.jpg', 'fixture-checksum-partner', '2026-02-14T01:02:30Z',
        '2026-02-14T01:02:40Z', NULL),
       ($3, $4, 'local', 'fixtures/legacy/withdrawn-receipt.jpg', 'image/jpeg', 1024,
        'withdrawn-receipt.jpg', 'fixture-checksum-withdrawn', '2026-03-03T01:02:30Z', NULL,
        '2026-03-05T01:02:30Z')`,
    [fixture.ownerFileId, fixture.partnerFileId, fixture.retiredFileId, fixture.liveLedgerId]
  );
  await pool.query(
    `INSERT INTO revision_files (id, ledger_id, revision_id, stored_file_id, position, created_at)
     VALUES
       ($1, $5, $2, $3, 0, '2026-03-01T01:02:35Z'),
       ($4, $5, $6, $7, 0, '2026-02-14T01:02:35Z'),
       ($8, $5, $9, $10, 0, '2026-03-03T01:02:35Z')`,
    [
      fixture.ownerFileLinkId,
      fixture.ownerEditRevisionId,
      fixture.ownerFileId,
      fixture.partnerFileLinkId,
      fixture.liveLedgerId,
      fixture.partnerActiveRevisionId,
      fixture.partnerFileId,
      fixture.retiredFileLinkId,
      fixture.ownerDeletedRevisionId,
      fixture.retiredFileId,
    ]
  );
  // One key per member, plus a retired one whose token columns were already
  // cleared when it was soft-deleted: the check constraint allows that only
  // while `deleted_at` is set, so the upgrade must not revive it.
  await pool.query(
    `INSERT INTO service_credentials (id, token_hash, token_prefix, token_suffix, ledger_id,
                                      attributed_user_id, name, created_at, last_used_at, deleted_at)
     VALUES
       ($1, 'fixture-owner-token-hash', 'ck_fixture_own', '1a2b', $3, $2, 'Owner key',
        '2026-01-10T00:00:00Z', '2026-06-10T00:00:00Z', NULL),
       ($4, 'fixture-partner-token-hash', 'ck_fixture_par', '3c4d', $3, $5, 'Partner key',
        '2026-02-10T00:00:00Z', NULL, NULL),
       ($6, NULL, NULL, NULL, $3, $5, 'Retired partner key', '2025-11-10T00:00:00Z',
        '2026-01-01T00:00:00Z', '2026-05-01T00:00:00Z')`,
    [
      fixture.ownerCredentialId,
      fixture.ownerId,
      fixture.liveLedgerId,
      fixture.partnerCredentialId,
      fixture.partnerId,
      fixture.retiredCredentialId,
    ]
  );
  return fixture;
}

interface PreservedRows {
  documents: Record<string, unknown>[];
  revisions: Record<string, unknown>[];
  entries: Record<string, unknown>[];
  categories: Record<string, unknown>[];
  storedFiles: Record<string, unknown>[];
  revisionFiles: Record<string, unknown>[];
  credentials: Record<string, unknown>[];
}

/**
 * Reads the rows the upgrade must carry over untouched. `attribution` is the
 * column 0048 renames, so reading `attributed_user_id` before and `book_id`
 * after must produce the same `book_id` values.
 */
async function readPreservedRows(
  pool: Pool,
  attribution: "attributed_user_id" | "book_id"
): Promise<PreservedRows> {
  const documents = await pool.query<Record<string, unknown>>(
    `SELECT id, ledger_id, ${attribution} AS book_id, title,
            document_date::text AS document_date, effective_date::text AS effective_date,
            active_revision_id, latest_submission_revision_id, version::text AS version,
            date_organization_suggestion::text AS date_organization_suggestion,
            created_at::text AS created_at, updated_at::text AS updated_at,
            deleted_at::text AS deleted_at
       FROM source_documents ORDER BY id`
  );
  const revisions = await pool.query<Record<string, unknown>>(
    `SELECT id, ledger_id, source_document_id, revision_number, title, origin::text AS origin,
            input_text, input_document_date, input_date_reference::text AS input_date_reference,
            processing_status::text AS processing_status, failure_kind::text AS failure_kind,
            failure_code, failure_message, submitted_at::text AS submitted_at,
            finished_at::text AS finished_at, created_at::text AS created_at
       FROM source_document_revisions ORDER BY id`
  );
  const entries = await pool.query<Record<string, unknown>>(
    `SELECT id, ledger_id, category_id, source_document_id, source_document_revision_id, position,
            amount::text AS amount, currency, item_name, description,
            converted_amount::text AS converted_amount, exchange_rate::text AS exchange_rate,
            created_at::text AS created_at, updated_at::text AS updated_at,
            deleted_at::text AS deleted_at
       FROM ledger_entries ORDER BY id`
  );
  const categories = await pool.query<Record<string, unknown>>(
    `SELECT id, ledger_id, name, description, icon, sort_order, created_at::text AS created_at,
            updated_at::text AS updated_at, deleted_at::text AS deleted_at
       FROM entry_categories ORDER BY id`
  );
  const storedFiles = await pool.query<Record<string, unknown>>(
    `SELECT id, ledger_id, storage_provider, storage_key, content_type, byte_size::text AS byte_size,
            original_filename, checksum, created_at::text AS created_at,
            finalized_at::text AS finalized_at, deleted_at::text AS deleted_at
       FROM stored_files ORDER BY id`
  );
  const revisionFiles = await pool.query<Record<string, unknown>>(
    `SELECT id, ledger_id, revision_id, stored_file_id, position, created_at::text AS created_at
       FROM revision_files ORDER BY id`
  );
  const credentials = await pool.query<Record<string, unknown>>(
    `SELECT id, ledger_id, ${attribution} AS book_id, name, token_hash, token_prefix, token_suffix,
            created_at::text AS created_at, last_used_at::text AS last_used_at,
            deleted_at::text AS deleted_at
       FROM service_credentials ORDER BY id`
  );
  return {
    documents: documents.rows,
    revisions: revisions.rows,
    entries: entries.rows,
    categories: categories.rows,
    storedFiles: storedFiles.rows,
    revisionFiles: revisionFiles.rows,
    credentials: credentials.rows,
  };
}

async function readLegacyUsers(pool: Pool): Promise<LegacyUserRow[]> {
  const result = await pool.query<LegacyUserRow>(
    `SELECT id, name, nickname, gender, time_zone, email, email_verified::text AS email_verified,
            password_hash, auth_version, preferences::text AS preferences,
            created_at::text AS created_at, updated_at::text AS updated_at,
            deleted_at::text AS deleted_at
       FROM users ORDER BY id`
  );
  return result.rows;
}

async function readUpgradedUsers(pool: Pool): Promise<UpgradedUserRow[]> {
  const result = await pool.query<UpgradedUserRow>(
    `SELECT id, name, password_hash, auth_version,
            created_at::text AS created_at, updated_at::text AS updated_at,
            deleted_at::text AS deleted_at
       FROM users ORDER BY id`
  );
  return result.rows;
}

async function readLedgers(pool: Pool): Promise<LedgerRow[]> {
  const result = await pool.query<LedgerRow>(
    `SELECT id, user_id, ai_language, preferred_currencies::text AS preferred_currencies,
            main_currency, collapse_entries_default, ai_custom_prompt,
            created_at::text AS created_at, updated_at::text AS updated_at,
            deleted_at::text AS deleted_at
       FROM ledgers ORDER BY id`
  );
  return result.rows;
}

async function readBooks(pool: Pool): Promise<BookRow[]> {
  const result = await pool.query<BookRow>(
    `SELECT id, ledger_id, name, time_zone, sort_order, archived_at::text AS archived_at
       FROM books ORDER BY sort_order, id`
  );
  return result.rows;
}

async function readSyncState(pool: Pool): Promise<SyncStateRow> {
  const result = await pool.query<SyncStateRow>(
    `SELECT ledger_id, version::text AS version, updated_at::text AS updated_at
       FROM ledger_sync_state`
  );
  return firstRow(result.rows, "Expected the fixture to have created ledger_sync_state");
}

async function readChangeBatches(pool: Pool): Promise<Record<string, unknown>[]> {
  const result = await pool.query<Record<string, unknown>>(
    `SELECT ledger_id, version::text AS version, transaction_id::text AS transaction_id,
            categories_changed, settings_changed, stats_changed, reset_required,
            created_at::text AS created_at
       FROM ledger_change_batches ORDER BY version`
  );
  return result.rows;
}

/** Counts documents per attribution column, the way 0048's checklist does. */
function countByAttribution(rows: Record<string, unknown>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = String(row.book_id);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

describe("published migration chain upgrade to one account with books", () => {
  it(
    "replays 0000 -> 0047, seeds the couple database, then applies every migration after it",
    { timeout: 300_000 },
    async () => {
      const { dataSchema, migrationsSchema } = deriveSchemaPair();
      const admin = await getTestPool().connect();
      let pool: Pool | undefined;
      let legacyDirectory: string | undefined;
      try {
        await admin.query(`CREATE SCHEMA ${quoteIdentifier(dataSchema)}`);
        pool = new Pool({
          connectionString: requireDatabaseUrl(),
          options: `-c search_path=${quoteIdentifier(dataSchema)},public`,
          max: 4,
        });
        const data = pool;
        // `public` stays on the path: the chain installs pg_trgm there.
        const probe = await data.query<{ schema: string }>("SELECT current_schema() AS schema");
        expect(firstRow(probe.rows, "current_schema()").schema).toBe(dataSchema);

        const legacy = createLegacyMigrationFolder();
        legacyDirectory = legacy.directory;
        const publishedEntries = readPublishedJournal().entries;

        // 1. The published chain up to 0047, in one migrator run.
        await runMigrations(data, legacy.directory, migrationsSchema);
        expect(await fetchMigrationLog(data, migrationsSchema)).toEqual(
          publishedMigrationLog(legacy.entries)
        );
        expect(legacy.entries).toHaveLength(48);
        expect(firstRow(legacy.entries.slice(-1), "legacy journal").tag).toBe(LEGACY_BOUNDARY_TAG);
        // The 0048 tables and the renamed column are not there yet, so a failure
        // below is 0048's or 0049's, not an earlier migration's.
        expect(await tableExists(data, "books")).toBe(false);
        expect(await tableExists(data, "login_emails")).toBe(false);
        expect(await columnNames(data, "source_documents")).toContain("attributed_user_id");

        // 2. Fully synthetic couple data in the shape 0047 left behind.
        const fixture = await seedLegacyCouple(data);
        const legacyUsers = await readLegacyUsers(data);
        const legacyOwner = firstRow(
          legacyUsers.filter((row) => row.id === fixture.ownerId),
          "fixture owner"
        );
        const legacyPartner = firstRow(
          legacyUsers.filter((row) => row.id === fixture.partnerId),
          "fixture partner"
        );
        const legacyDocuments = await readPreservedRows(data, "attributed_user_id");
        const legacyState = {
          ...legacyDocuments,
          ledgers: await readLedgers(data),
          syncState: await readSyncState(data),
          changeBatches: await readChangeBatches(data),
          ownerChallenges: await data.query(
            `SELECT id, user_id, new_email, token_hash, expires_at::text AS expires_at, attempts,
                    created_at::text AS created_at
               FROM email_change_challenges WHERE user_id = $1 ORDER BY id`,
            [fixture.ownerId]
          ),
        };
        expect(legacyOwner.time_zone).toBe("Asia/Kuala_Lumpur");
        expect(legacyPartner.time_zone).toBe("Asia/Shanghai");
        // The fixture exercises the creator column 0048 drops: two records were
        // typed by the other member.
        expect(
          await scalarCount(
            data,
            `SELECT count(*)::int AS count FROM source_documents
              WHERE created_by_user_id IS DISTINCT FROM attributed_user_id`
          )
        ).toBe(2);
        expect(legacyState.syncState.version).toBe(String(FIXTURE_SYNC_VERSION));

        // 3. The remaining published migrations, from the real directory and
        //    through the same bookkeeping schema.
        await runMigrations(data, MIGRATIONS_DIRECTORY, migrationsSchema);
        expect(await fetchMigrationLog(data, migrationsSchema)).toEqual(
          publishedMigrationLog(publishedEntries)
        );

        // 0048: the two members become one account with two login addresses.
        // 0056 then removes the account the couple had already retired.
        const upgradedUsers = await readUpgradedUsers(data);
        expect(upgradedUsers).toHaveLength(1);
        const upgradedOwner = firstRow(upgradedUsers, "upgraded owner");
        // The owner keeps everything but the per-person columns, and is signed
        // out once; the partner's row is gone.
        expect(upgradedOwner).toEqual({
          id: fixture.ownerId,
          name: legacyOwner.name,
          password_hash: legacyOwner.password_hash,
          auth_version: legacyOwner.auth_version + 1,
          created_at: legacyOwner.created_at,
          updated_at: legacyOwner.updated_at,
          deleted_at: null,
        });

        // Both addresses point at the account that survives, and each keeps its
        // own verification and timestamps.
        const loginEmails = await data.query<LoginEmailRow>(
          `SELECT id, user_id, email, email_verified::text AS email_verified,
                  created_at::text AS created_at, updated_at::text AS updated_at
             FROM login_emails ORDER BY email`
        );
        const emailsByAddress = new Map(loginEmails.rows.map((row) => [row.email, row]));
        expect([...emailsByAddress.keys()].sort()).toEqual([PARTNER_EMAIL, OWNER_EMAIL].sort());
        expect(emailsByAddress.get(OWNER_EMAIL)).toEqual({
          id: expect.any(String),
          user_id: fixture.ownerId,
          email: OWNER_EMAIL,
          email_verified: legacyOwner.email_verified,
          created_at: legacyOwner.created_at,
          updated_at: legacyOwner.updated_at,
        });
        expect(emailsByAddress.get(PARTNER_EMAIL)).toEqual({
          id: expect.any(String),
          user_id: fixture.ownerId,
          email: PARTNER_EMAIL,
          email_verified: legacyPartner.email_verified,
          created_at: legacyPartner.created_at,
          updated_at: legacyPartner.updated_at,
        });

        // A pending address change followed its owner out; the surviving
        // account's own challenge is untouched.
        expect(
          await scalarCount(data, `SELECT count(*)::int AS count FROM email_change_challenges`)
        ).toBe(1);
        const ownerChallenges = await data.query(
          `SELECT id, user_id, new_email, token_hash, expires_at::text AS expires_at, attempts,
                  created_at::text AS created_at
             FROM email_change_challenges ORDER BY id`
        );
        expect(ownerChallenges.rows).toEqual(legacyState.ownerChallenges.rows);

        // The person-books reuse the member UUIDs, so attribution itself is the
        // rename; 共同支出 is new, and the retired ledger gets no book at all.
        const books = await readBooks(data);
        expect(books).toEqual([
          {
            id: fixture.ownerId,
            ledger_id: fixture.liveLedgerId,
            name: "哞哞的",
            time_zone: legacyOwner.time_zone,
            sort_order: 1,
            archived_at: null,
          },
          {
            id: fixture.partnerId,
            ledger_id: fixture.liveLedgerId,
            name: "梁梁的",
            time_zone: legacyPartner.time_zone,
            sort_order: 2,
            archived_at: null,
          },
          {
            id: expect.any(String),
            ledger_id: fixture.liveLedgerId,
            name: "共同支出",
            time_zone: null,
            sort_order: 3,
            archived_at: null,
          },
        ]);
        expect(
          await scalarCount(data, `SELECT count(*)::int AS count FROM books WHERE ledger_id = $1`, [
            fixture.historicalLedgerId,
          ])
        ).toBe(0);

        // The old ledger cap is handed over before the partner row goes, so the
        // live ledger is not cascaded away; 0056 removes the retired one.
        const upgradedLedgers = await readLedgers(data);
        expect(upgradedLedgers).toEqual(
          legacyState.ledgers
            .filter((row) => row.id === fixture.liveLedgerId)
            .map((row) => ({ ...row, user_id: fixture.ownerId }))
        );

        // Records: the same rows, the same person, nothing lost or duplicated.
        const upgradedDocuments = await readPreservedRows(data, "book_id");
        expect(upgradedDocuments.documents).toEqual(legacyState.documents);
        expect(countByAttribution(upgradedDocuments.documents)).toEqual(
          countByAttribution(legacyState.documents)
        );
        expect(upgradedDocuments.documents).toHaveLength(4);
        expect(countByAttribution(upgradedDocuments.documents)).toEqual(
          new Map([
            [fixture.ownerId, 2],
            [fixture.partnerId, 2],
          ])
        );
        // The attribution column is the only thing the records lost.
        expect(await columnNames(data, "source_documents")).toContain("book_id");
        expect(await columnNames(data, "source_documents")).not.toContain("attributed_user_id");
        expect(await columnNames(data, "source_documents")).not.toContain("created_by_user_id");

        // Amounts, currencies, dates, revisions, categories and file links read
        // back exactly as they were written, including their scale.
        expect(upgradedDocuments.revisions).toEqual(legacyState.revisions);
        expect(upgradedDocuments.entries).toEqual(legacyState.entries);
        expect(upgradedDocuments.categories).toEqual(legacyState.categories);
        expect(upgradedDocuments.storedFiles).toEqual(legacyState.storedFiles);
        expect(upgradedDocuments.revisionFiles).toEqual(legacyState.revisionFiles);
        expect(
          (
            await data.query<{ currency: string; total: string }>(
              `SELECT currency, sum(amount)::text AS total FROM ledger_entries
              WHERE deleted_at IS NULL GROUP BY currency ORDER BY currency`
            )
          ).rows
        ).toEqual([
          { currency: "CNY", total: "2228.500" },
          { currency: "USD", total: "42.000" },
        ]);
        expect(
          (
            await data.query<{
              amount: string;
              currency: string;
              converted_amount: string;
              exchange_rate: string;
            }>(
              `SELECT amount::text AS amount, currency, converted_amount::text AS converted_amount,
                    exchange_rate::text AS exchange_rate
               FROM ledger_entries WHERE id = $1`,
              [fixture.usdEntryId]
            )
          ).rows
        ).toEqual([
          {
            amount: "42.000",
            currency: "USD",
            converted_amount: "300.000",
            exchange_rate: "7.142857142857",
          },
        ]);
        expect(
          new Set(
            (
              await data.query<{ storage_key: string }>(
                `SELECT storage_key FROM stored_files ORDER BY storage_key`
              )
            ).rows.map((row) => row.storage_key)
          )
        ).toEqual(
          new Set([
            "fixtures/legacy/owner-receipt.jpg",
            "fixtures/legacy/partner-receipt.jpg",
            "fixtures/legacy/withdrawn-receipt.jpg",
          ])
        );

        // Retired rows stay retired: the soft-deleted document, entry, category,
        // key, file and ledger all keep their `deleted_at`.
        const deletedStates = await data.query<{
          documents: string | null;
          entries: string | null;
          categories: string | null;
          credentials: string | null;
          files: string | null;
        }>(
          `SELECT (SELECT deleted_at::text FROM source_documents WHERE id = $1) AS documents,
                  (SELECT deleted_at::text FROM ledger_entries WHERE id = $2) AS entries,
                  (SELECT deleted_at::text FROM entry_categories WHERE id = $3) AS categories,
                  (SELECT deleted_at::text FROM service_credentials WHERE id = $4) AS credentials,
                  (SELECT deleted_at::text FROM stored_files WHERE id = $5) AS files`,
          [
            fixture.ownerDeletedDocumentId,
            fixture.deletedEntryId,
            fixture.retiredCategoryId,
            fixture.retiredCredentialId,
            fixture.retiredFileId,
          ]
        );
        for (const deletedAt of Object.values(
          firstRow(deletedStates.rows, "deleted state probe")
        )) {
          expect(deletedAt).not.toBeNull();
        }

        // Keys belong to their owner's book, and the ledger binding is intact.
        const upgradedCredentials = upgradedDocuments.credentials;
        expect(upgradedCredentials).toEqual(legacyState.credentials);
        const credentialBooks = new Map(
          upgradedCredentials.map((row) => [String(row.id), String(row.book_id)])
        );
        expect(credentialBooks.get(fixture.ownerCredentialId)).toBe(fixture.ownerId);
        expect(credentialBooks.get(fixture.partnerCredentialId)).toBe(fixture.partnerId);
        expect(credentialBooks.get(fixture.retiredCredentialId)).toBe(fixture.partnerId);
        for (const row of upgradedCredentials) expect(row.ledger_id).toBe(fixture.liveLedgerId);
        expect(await columnNames(data, "service_credentials")).toContain("book_id");
        expect(await columnNames(data, "service_credentials")).not.toContain("attributed_user_id");

        // 0048's structure, and the pieces 0049 removes.
        const constraints = await constraintDefinitions(data);
        for (const name of [
          "fk_source_documents_book_ledger",
          "fk_service_credentials_book_ledger",
          "books_ledger_id_ledgers_id_fk",
          "ck_books_name_length",
          "ck_books_time_zone_length",
          "login_emails_user_id_users_id_fk",
          "ck_setup_state_single_row",
          "ck_setup_state_failed_attempts",
        ]) {
          expect(constraints.has(name), `missing constraint ${name}`).toBe(true);
        }
        expect(constraints.get("fk_source_documents_book_ledger")).toContain(
          "FOREIGN KEY (ledger_id, book_id)"
        );
        expect(constraints.get("fk_source_documents_book_ledger")).toContain(
          "REFERENCES books(ledger_id, id)"
        );
        expect(constraints.get("fk_service_credentials_book_ledger")).toContain(
          "FOREIGN KEY (ledger_id, book_id)"
        );
        for (const name of [
          "source_documents_attributed_user_id_users_id_fk",
          "source_documents_created_by_user_id_users_id_fk",
          "service_credentials_attributed_user_id_users_id_fk",
          "ck_users_nickname_length",
          "ck_users_gender",
          "ck_users_time_zone_length",
        ]) {
          expect(constraints.has(name), `unexpected constraint ${name}`).toBe(false);
        }

        const indexes = await indexDefinitions(data);
        for (const name of [
          "uq_books_ledger_id_id",
          "uniq_books_active_name",
          "idx_books_active_sort",
          "idx_source_documents_ledger_book",
          "idx_service_credentials_ledger_book",
          "uniq_login_emails_email",
          "idx_login_emails_user_id",
        ]) {
          expect(indexes.has(name), `missing index ${name}`).toBe(true);
        }
        for (const name of [
          "uniq_books_default",
          "uniq_users_active_email",
          "uniq_ledgers_user_id",
          "idx_source_documents_ledger_attribution",
        ]) {
          expect(indexes.has(name), `unexpected index ${name}`).toBe(false);
        }

        expect(await columnNames(data, "books")).toEqual([
          "archived_at",
          "created_at",
          "id",
          "ledger_id",
          "name",
          "sort_order",
          "time_zone",
          "updated_at",
        ]);
        expect(await columnNames(data, "users")).toEqual([
          "auth_version",
          "created_at",
          "deleted_at",
          "id",
          "image",
          "name",
          "password_hash",
          "password_updated_at",
          "updated_at",
        ]);
        expect(await tableExists(data, "login_emails")).toBe(true);
        expect(await tableExists(data, "setup_state")).toBe(true);
        expect(await scalarCount(data, `SELECT count(*)::int AS count FROM setup_state`)).toBe(0);

        // Every foreign key, unique key, check and index 0048 added is valid,
        // and the old ones are gone rather than merely unenforced.
        expect(
          await scalarCount(
            data,
            `SELECT count(*)::int AS count FROM pg_constraint con
               JOIN pg_class cls ON cls.oid = con.conrelid
               JOIN pg_namespace ns ON ns.oid = cls.relnamespace
              WHERE ns.nspname = current_schema() AND NOT con.convalidated`
          )
        ).toBe(0);
        expect(
          await scalarCount(
            data,
            `SELECT count(*)::int AS count FROM pg_index index
               JOIN pg_class cls ON cls.oid = index.indexrelid
               JOIN pg_namespace ns ON ns.oid = cls.relnamespace
              WHERE ns.nspname = current_schema() AND NOT index.indisvalid`
          )
        ).toBe(0);

        // The sync state the couple had is the sync state it keeps, and the
        // change log still records a write against the new book.
        const syncStateAfterUpgrade = await readSyncState(data);
        expect(syncStateAfterUpgrade).toEqual(legacyState.syncState);
        expect(await tableExists(data, "ledger_change_batches")).toBe(false);
        const watermarks = await data.query(
          "SELECT categories_version::text, settings_version::text, stats_version::text FROM ledger_sync_state"
        );
        expect(watermarks.rows[0]).toEqual({
          categories_version: String(FIXTURE_SYNC_VERSION),
          settings_version: String(FIXTURE_SYNC_VERSION),
          stats_version: String(FIXTURE_SYNC_VERSION),
        });
        const sharedBookId = firstRow(
          books.filter((book) => book.name === "共同支出"),
          "共同支出 book"
        ).id;
        const postUpgradeDocumentId = crypto.randomUUID();
        await data.query(
          `INSERT INTO source_documents (id, ledger_id, book_id, title, document_date, version,
                                         created_at, updated_at)
           VALUES ($1, $2, $3, 'Post-upgrade entry', '2026-09-19', 1, now(), now())`,
          [postUpgradeDocumentId, fixture.liveLedgerId, sharedBookId]
        );
        const upgradedWrite = await data.query<{ book_id: string; effective_date: string }>(
          `SELECT book_id, effective_date::text AS effective_date FROM source_documents
            WHERE id = $1`,
          [postUpgradeDocumentId]
        );
        expect(firstRow(upgradedWrite.rows, "post-upgrade document").book_id).toBe(sharedBookId);
        const syncStateAfterWrite = await readSyncState(data);
        expect(syncStateAfterWrite.version).toBe(String(FIXTURE_SYNC_VERSION + 1));
        const afterWrite = await data.query("SELECT stats_version::text FROM ledger_sync_state");
        expect(afterWrite.rows[0].stats_version).toBe(String(FIXTURE_SYNC_VERSION + 1));

        // 0049 really removed the default-book structure: the column and its
        // index are gone, and the three books are ordinary rows.
        expect(await columnNames(data, "books")).not.toContain("is_default");
        expect(indexes.has("uniq_books_default")).toBe(false);
        expect(books.map((book) => book.name)).toEqual(["哞哞的", "梁梁的", "共同支出"]);

        // The constraints still bite: a duplicate live name, an unknown book, a
        // too-long name and an under-hashed live key are all refused. The probes
        // need one connection of their own so that the savepoints and the
        // rollbacks share a session, and every probe is rolled back.
        const probeConnection = await data.connect();
        try {
          await probeConnection.query("BEGIN");
          try {
            await probeConnection.query("SAVEPOINT probe");
            await expect(
              probeConnection.query(
                `INSERT INTO books (ledger_id, name, sort_order) VALUES ($1, '共同支出', 4)`,
                [fixture.liveLedgerId]
              )
            ).rejects.toMatchObject({ code: "23505" });
            await probeConnection.query("ROLLBACK TO SAVEPOINT probe");
            await expect(
              probeConnection.query(
                `INSERT INTO service_credentials (ledger_id, book_id, name, token_hash, token_prefix,
                                                    token_suffix, created_at)
                 VALUES ($1, $2, 'Orphan key', 'fixture-orphan-hash', 'ck_fixture_orp', '9f9f', now())`,
                [fixture.liveLedgerId, crypto.randomUUID()]
              )
            ).rejects.toMatchObject({ code: "23503" });
            await probeConnection.query("ROLLBACK TO SAVEPOINT probe");
            await expect(
              probeConnection.query(
                `INSERT INTO books (ledger_id, name, sort_order) VALUES ($1, $2, 4)`,
                [fixture.liveLedgerId, "x".repeat(21)]
              )
            ).rejects.toMatchObject({ code: "23514" });
            await probeConnection.query("ROLLBACK TO SAVEPOINT probe");
            await expect(
              probeConnection.query(
                `INSERT INTO service_credentials (ledger_id, book_id, name, created_at)
                 VALUES ($1, $2, 'Unhashed live key', now())`,
                [fixture.liveLedgerId, sharedBookId]
              )
            ).rejects.toMatchObject({ code: "23514" });
          } finally {
            await probeConnection.query("ROLLBACK");
          }
          // Archived books may reuse a live name; that is the only reason the
          // name index is partial, and 0049 left it alone.
          await probeConnection.query("BEGIN");
          try {
            await probeConnection.query(
              `INSERT INTO books (ledger_id, name, sort_order, archived_at)
               VALUES ($1, '共同支出', 4, now())`,
              [fixture.liveLedgerId]
            );
          } finally {
            await probeConnection.query("ROLLBACK");
          }
        } finally {
          probeConnection.release();
        }

        // 4. Running the migrator again changes nothing at all.
        const migrationLogBeforeNoop = await fetchMigrationLog(data, migrationsSchema);
        const fingerprintBeforeNoop = await schemaFingerprint(data);
        const booksBeforeNoop = await readBooks(data);
        const syncBeforeNoop = await readSyncState(data);
        const documentsBeforeNoop = await scalarCount(
          data,
          `SELECT count(*)::int AS count FROM source_documents`
        );
        await runMigrations(data, MIGRATIONS_DIRECTORY, migrationsSchema);
        expect(await fetchMigrationLog(data, migrationsSchema)).toEqual(migrationLogBeforeNoop);
        expect(await schemaFingerprint(data)).toBe(fingerprintBeforeNoop);
        expect(await readBooks(data)).toEqual(booksBeforeNoop);
        expect(await readSyncState(data)).toEqual(syncBeforeNoop);
        expect(await scalarCount(data, `SELECT count(*)::int AS count FROM source_documents`)).toBe(
          documentsBeforeNoop
        );
        // The whole published chain applied, ending where the journal ends.
        const published = readPublishedJournal().entries;
        expect(migrationLogBeforeNoop).toHaveLength(published.length);
        expect(firstRow(migrationLogBeforeNoop.slice(-1), "last migration").when).toBe(
          firstRow(published.slice(-1), "last journal entry").when
        );
      } finally {
        await pool?.end().catch(() => undefined);
        await admin
          .query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(migrationsSchema)} CASCADE`)
          .catch(() => undefined);
        await admin
          .query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(dataSchema)} CASCADE`)
          .catch(() => undefined);
        if (legacyDirectory !== undefined) {
          rmSync(legacyDirectory, { recursive: true, force: true });
        }
        admin.release();
      }
    }
  );
});
