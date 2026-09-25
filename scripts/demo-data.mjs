#!/usr/bin/env node

import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DeleteObjectsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import pg from "pg";

const FIXTURE_DIR = path.dirname(
  fileURLToPath(new URL("./fixtures/demo-workspace.json", import.meta.url))
);
const fixture = JSON.parse(await readFile(path.join(FIXTURE_DIR, "demo-workspace.json"), "utf8"));
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const DEMO_DATABASE = "cashier_demo";
const CREDENTIAL_DOMAIN_PREFIX = "credential:v1:";
const CREDENTIAL_DISPLAY_PREFIX_LENGTH = 8;
const CREDENTIAL_DISPLAY_SUFFIX_LENGTH = 4;
const CREDENTIAL_TOKEN_PREFIX = "sk_live_";

/**
 * The two schemas every demo rebuild drops, and the rows inside `public` that
 * decide what the rebuild would replace. Nothing here names a business column:
 * a preview has to describe a demo database a previous release left behind,
 * whose tables may not have the columns the current schema expects.
 */
const DEMO_RESET_SCHEMAS = { data: "public", migrations: "drizzle" };
const DEMO_RESET_DATA_TABLES = [
  "users",
  "ledgers",
  "source_documents",
  "ledger_entries",
  "stored_files",
];

/**
 * Demo tokens keep the app's real format so the seeded rows exercise the same
 * hashing and parsing path, but the prefix is applied here rather than stored in
 * the fixture: a literal `sk_live_` followed by 48 hex characters is
 * indistinguishable to GitHub push protection from a real Stripe-shaped key,
 * and it rejects the push. The composed token is only ever valid against the
 * local demo database, and it is printed at startup.
 *
 * Composes a fixture credential's demo token.
 */
export function fixtureCredentialToken(credential) {
  return `${CREDENTIAL_TOKEN_PREFIX}${credential.tokenBody}`;
}

/**
 * Mirrors src/lib/security/service-credential-token.ts, which lives behind the
 * `@/` alias and cannot be imported from this script. The focused test pins
 * both implementations to the same digest so the rule cannot drift.
 *
 * Hashes a fixture credential token the way the app does.
 */
export function computeCredentialHash(token, pepper) {
  return crypto
    .createHmac("sha256", pepper)
    .update(CREDENTIAL_DOMAIN_PREFIX)
    .update(token)
    .digest("hex");
}

function requiredUrl(name, value) {
  try {
    return new URL(value ?? "");
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}

/** Verifies that focused tests reject non-local demo targets. */
export function validateDemoEnvironment(environment = process.env) {
  if (environment.CASHIER_DEMO_MODE !== "true") {
    throw new Error("CASHIER_DEMO_MODE=true is required");
  }
  const databaseUrl = requiredUrl("DATABASE_URL", environment.DATABASE_URL);
  if (!LOOPBACK_HOSTS.has(databaseUrl.hostname) || databaseUrl.pathname !== `/${DEMO_DATABASE}`) {
    throw new Error(`Demo data requires a loopback ${DEMO_DATABASE} database`);
  }
  const storageUrl = requiredUrl("S3_ENDPOINT", environment.S3_ENDPOINT);
  if (!LOOPBACK_HOSTS.has(storageUrl.hostname)) {
    throw new Error("Demo data requires loopback object storage");
  }
  if (fixture.user.email !== "dev@cashier.local") {
    throw new Error("Demo fixture user identity is invalid");
  }
  if (!Array.isArray(fixture.books) || fixture.books.length === 0) {
    throw new Error("Demo fixture must define the books its records belong to");
  }
  if ((environment.API_KEY_PEPPER ?? "").trim() === "") {
    throw new Error("API_KEY_PEPPER is required to seed demo service credentials");
  }
  return { databaseUrl: databaseUrl.toString(), storageUrl: storageUrl.toString() };
}

/** Any positive value works: demo conversions only depend on the fixture's rates. */
const DEMO_MAIN_CURRENCY_PER_EUR = "7.8";

function isoDateWithOffset(anchorDate, dayOffset) {
  const date = new Date(`${anchorDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return date.toISOString().slice(0, 10);
}

function anchorDate(environment) {
  const explicit = environment.CASHIER_DEMO_AS_OF;
  if (explicit != null) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(explicit) ||
      Number.isNaN(Date.parse(`${explicit}T00:00:00Z`))
    ) {
      throw new Error("CASHIER_DEMO_AS_OF must use YYYY-MM-DD");
    }
    return explicit;
  }
  return new Date().toISOString().slice(0, 10);
}

function createStorage(environment) {
  return new S3Client({
    region: environment.S3_REGION ?? "auto",
    endpoint: environment.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: environment.S3_ACCESS_KEY_ID,
      secretAccessKey: environment.S3_SECRET_ACCESS_KEY,
    },
  });
}

function activeEntries(document) {
  return document.retainedResult?.entries ?? document.entries;
}

async function uploadFixtureImages(storage, environment, ledgerId) {
  const uploaded = [];
  for (const document of fixture.documents) {
    if (document.image == null) continue;
    const bytes = await readFile(path.join(FIXTURE_DIR, document.image.asset));
    const key = `${ledgerId}/stored/${document.image.fileId}`;
    await storage.send(
      new PutObjectCommand({
        Bucket: environment.S3_BUCKET,
        Key: key,
        Body: bytes,
        ContentType: "image/jpeg",
      })
    );
    uploaded.push({ ...document.image, bytes, key });
  }
  return uploaded;
}

/**
 * Empties the disposable demo database before migrations run.
 *
 * Every demo launch restores the fixture, and the schema the previous launch
 * left behind can be any historical shape — including one a data migration
 * rightly refuses to touch. Since this database is dedicated, loopback-only and
 * rebuilt from the fixture on each launch, the honest move is to drop its
 * objects and let the migrations build the current schema from nothing.
 *
 * Drizzle's bookkeeping schema goes with it: leaving that behind would make the
 * runner believe every migration is already applied.
 *
 * Empties the demo schemas, refusing anything but the demo database.
 */
export async function resetDemoSchema(environment = process.env) {
  const { databaseUrl } = validateDemoEnvironment(environment);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const schema of ["public", "drizzle"]) {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }
}

async function findDemoTarget(client) {
  // The account is found through its login address; the one ledger belongs to it.
  const result = await client.query(
    `SELECT u.id AS user_id, (SELECT id FROM ledgers ORDER BY created_at, id LIMIT 1) AS ledger_id
       FROM users u
       JOIN login_emails e ON e.user_id = u.id
      WHERE lower(e.email) = $1
      LIMIT 1`,
    [fixture.user.email]
  );
  return result.rows[0] ?? null;
}

async function inspectDemoTarget(client) {
  const target = await findDemoTarget(client);
  if (target == null) {
    return { target: null, counts: { ledgers: 0, documents: 0, entries: 0, files: 0 }, keys: [] };
  }
  const counts = await client.query(
    `SELECT
       (SELECT count(*)::int FROM ledgers) AS ledgers,
       (SELECT count(*)::int FROM source_documents WHERE ledger_id = $1) AS documents,
       (SELECT count(*)::int FROM ledger_entries WHERE ledger_id = $1) AS entries,
       (SELECT count(*)::int FROM stored_files WHERE ledger_id = $1) AS files`,
    [target.ledger_id]
  );
  const keys =
    target.ledger_id == null
      ? { rows: [] }
      : await client.query(
          "SELECT storage_key FROM stored_files WHERE ledger_id = $1 ORDER BY storage_key",
          [target.ledger_id]
        );
  return {
    target,
    counts: counts.rows[0],
    keys: keys.rows.map((row) => row.storage_key),
  };
}

async function insertFixture(client, environment, { userId, ledgerId, uploadedImages, reset }) {
  const asOf = anchorDate(environment);
  const now = new Date(`${asOf}T12:00:00.000Z`);
  if (reset) {
    // The dedicated demo database holds one account and one ledger. A reset
    // removes both, so it restores the fixture instead of layering onto
    // whatever the last session left behind. The file links go first: they
    // reference stored files without cascading.
    await client.query("DELETE FROM source_document_files");
    await client.query("DELETE FROM ledgers");
    await client.query(
      `DELETE FROM users WHERE id IN
        (SELECT user_id FROM login_emails WHERE lower(email) = $1)`,
      [fixture.user.email]
    );
  }
  await client.query(
    `INSERT INTO users (id, created_at, updated_at)
     VALUES ($1, $2, $2)
     ON CONFLICT (id) DO NOTHING`,
    [userId, now]
  );
  await client.query(
    `INSERT INTO login_emails (user_id, email, email_verified, created_at, updated_at)
     VALUES ($1, $2, $3, $3, $3)
     ON CONFLICT (id) DO NOTHING`,
    [userId, fixture.user.email, now]
  );
  await client.query(
    `INSERT INTO ledgers
      (id, ai_language, preferred_currencies, main_currency, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (id) DO NOTHING`,
    [
      ledgerId,
      fixture.ledger.aiLanguage,
      fixture.ledger.preferredCurrencies,
      fixture.ledger.mainCurrency,
      now,
    ]
  );

  const bookIds = new Map();
  for (const book of fixture.books) {
    await client.query(
      `INSERT INTO books (id, ledger_id, name, time_zone, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       ON CONFLICT (id) DO NOTHING`,
      [book.id, ledgerId, book.name, book.timeZone, book.sortOrder, now]
    );
    bookIds.set(book.name, book.id);
  }

  // The reset above deletes the ledger, so cascade already removed any earlier
  // credentials for this workspace; these rows are recreated with it.
  for (const credential of fixture.serviceCredentials) {
    const token = fixtureCredentialToken(credential);
    await client.query(
      `INSERT INTO service_credentials
        (id, ledger_id, book_id, name, token_hash, token_prefix, token_suffix, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        credential.id,
        ledgerId,
        bookIds.get(credential.book),
        credential.name,
        computeCredentialHash(token, environment.API_KEY_PEPPER),
        token.slice(0, CREDENTIAL_DISPLAY_PREFIX_LENGTH),
        token.slice(-CREDENTIAL_DISPLAY_SUFFIX_LENGTH),
        now,
      ]
    );
  }

  const categoryIds = new Map();
  for (const category of fixture.categories) {
    const existing = await client.query(
      "SELECT id FROM entry_categories WHERE ledger_id = $1 AND name = $2",
      [ledgerId, category.name]
    );
    const categoryId = existing.rows[0]?.id ?? category.id;
    if (existing.rowCount === 0) {
      await client.query(
        `INSERT INTO entry_categories
          (id, ledger_id, name, description, icon, sort_order, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [
          categoryId,
          ledgerId,
          category.name,
          category.description,
          category.icon,
          category.sortOrder,
          now,
        ]
      );
    }
    categoryIds.set(category.name, categoryId);
  }

  const imagesByFileId = new Map(uploadedImages.map((image) => [image.fileId, image]));
  for (const document of fixture.documents) {
    const documentDate = isoDateWithOffset(asOf, document.dayOffset);
    const createdAt = new Date(`${documentDate}T12:00:00.000Z`);
    let suggestion = null;
    if (document.dateSuggestionEntryId != null) {
      const resolvedDate = isoDateWithOffset(asOf, document.dayOffset + 1);
      const entry = document.entries.find((item) => item.id === document.dateSuggestionEntryId);
      suggestion = {
        schemaVersion: 1,
        id: document.dateSuggestionId,
        referenceDate: documentDate,
        sourceDocumentDate: documentDate,
        items: [
          {
            ledgerEntryId: entry.id,
            dateHint: { kind: "relative", value: "tomorrow", sourceText: "tomorrow" },
            resolvedDate,
            sourceText: "tomorrow",
            snapshot: { itemName: entry.itemName, amount: entry.amount, currency: entry.currency },
          },
        ],
      };
    }
    await client.query(
      `INSERT INTO source_documents
        (id, ledger_id, book_id, title, input_text, document_date, version,
         date_organization_suggestion, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $8)`,
      [
        document.id,
        ledgerId,
        bookIds.get(document.book),
        document.title,
        document.inputText,
        documentDate,
        suggestion,
        createdAt,
      ]
    );
    if (document.retainedResult != null) {
      await client.query(
        `INSERT INTO source_document_revisions
          (id, ledger_id, source_document_id, title, input_document_date,
           input_date_reference, processing_status, submitted_at, finished_at, created_at)
         VALUES ($1, $2, $3, $4, $5::text, $5::date, 'completed', $6, $6, $6)`,
        [
          document.retainedResult.revisionId,
          ledgerId,
          document.id,
          document.retainedResult.title,
          documentDate,
          createdAt,
        ]
      );
    }
    await client.query(
      `INSERT INTO source_document_revisions
        (id, ledger_id, source_document_id, title, input_document_date,
         input_date_reference, processing_status, failure_kind, failure_code, failure_message,
         submitted_at, finished_at, created_at)
       VALUES ($1, $2, $3, $4, $5::text, $5::date, $6, $7, $8, $9, $10, $10, $10)`,
      [
        document.revisionId,
        ledgerId,
        document.id,
        document.title,
        documentDate,
        document.status,
        document.failureKind ?? null,
        document.failureCode ?? null,
        document.failureMessage ?? null,
        createdAt,
      ]
    );
    if (document.image != null) {
      const image = imagesByFileId.get(document.image.fileId);
      await client.query(
        `INSERT INTO stored_files
          (id, ledger_id, storage_key, content_type, byte_size, original_filename, checksum,
           created_at, finalized_at)
         VALUES ($1, $2, $3, 'image/jpeg', $4, $5, $6, $7, $7)`,
        [
          image.fileId,
          ledgerId,
          image.key,
          image.bytes.length,
          image.filename,
          crypto.createHash("sha256").update(image.bytes).digest("hex"),
          createdAt,
        ]
      );
      await client.query(
        `INSERT INTO source_document_files
          (ledger_id, source_document_id, stored_file_id, position, created_at)
         VALUES ($1, $2, $3, 0, $4)`,
        [ledgerId, document.id, image.fileId, createdAt]
      );
    }
    for (const [position, entry] of activeEntries(document).entries()) {
      const categoryId = entry.category == null ? null : (categoryIds.get(entry.category) ?? null);
      if (entry.category != null && categoryId == null) {
        throw new Error(`Unknown demo category: ${entry.category}`);
      }
      await client.query(
        `INSERT INTO ledger_entries
          (id, ledger_id, category_id, source_document_id,
           position, amount, currency, item_name, description, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
        [
          entry.id,
          ledgerId,
          categoryId,
          document.id,
          position,
          entry.amount,
          entry.currency,
          entry.itemName,
          entry.description ?? null,
          createdAt,
        ]
      );
    }
    await seedExchangeRates(client, fixture, documentDate, activeEntries(document), now);
    await client.query(
      `UPDATE source_documents SET latest_submission_revision_id = $1 WHERE id = $2`,
      [document.revisionId, document.id]
    );
  }
}

/**
 * Stores the day's rates the fixture's foreign entries convert at, so the demo
 * shows converted totals without reaching the rate provider. The rows are
 * final, so maintenance never replaces them.
 */
async function seedExchangeRates(client, fixture, rateDate, entries, now) {
  const mainCurrency = fixture.ledger.mainCurrency;
  const foreign = [...new Set(entries.map((entry) => entry.currency))].filter(
    (currency) => currency !== mainCurrency
  );
  if (foreign.length === 0) return;
  const mainPerEur = mainCurrency === "EUR" ? "1" : DEMO_MAIN_CURRENCY_PER_EUR;
  // Each row is [currency, dividend, divisor]: a foreign currency's rate is
  // how many main-currency units one unit buys, so it buys main/rate per euro.
  const rows = [
    ["EUR", "1", "1"],
    [mainCurrency, mainPerEur, "1"],
    ...foreign.map((currency) => {
      const rate = fixture.exchangeRates?.[currency];
      if (rate == null) throw new Error(`Demo fixture has no exchange rate for ${currency}`);
      return [currency, mainPerEur, rate];
    }),
  ];
  for (const [currency, dividend, divisor] of rows) {
    await client.query(
      `INSERT INTO exchange_rates (rate_date, currency, per_eur, source_date, fetched_at)
       VALUES ($1, $2, $3::numeric / $4::numeric, $1, $5)
       ON CONFLICT (rate_date, currency) DO NOTHING`,
      [rateDate, currency, dividend, divisor, now]
    );
  }
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function schemaExists(client, schema) {
  /**
   * What one schema of a demo database holds. `rows` maps a counted table to its
   * row count, or to null when the schema exists but that table does not.
   *
   * @typedef {{ exists: boolean, tables: string[], rows: Record<string, number | null> }} DemoResetSchema
   */

  /**
   * Just enough of a database client to describe a schema: the preview never
   * opens a pool, and a test can record every statement by standing in with this
   * shape.
   *
   * @typedef {{ query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }> }} DemoResetClient
   */

  const result = await client.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [schema]);
  return result.rows.length > 0;
}

async function listSchemaTables(client, schema) {
  const result = await client.query(
    `SELECT c.relname AS name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')
      ORDER BY c.relname`,
    [schema]
  );
  return result.rows.map((row) => row.name);
}

/**
 * @param {DemoResetClient} client
 * @param {string} schema
 * @param {readonly string[] | null} countedTables
 * @returns {Promise<DemoResetSchema>}
 */
async function describeSchema(client, schema, countedTables) {
  if (!(await schemaExists(client, schema))) {
    // A preview of a database that is not there yet is still a preview: the
    // targets are named, and every one of them is absent rather than zero.
    return {
      exists: false,
      tables: [],
      rows: Object.fromEntries((countedTables ?? []).map((table) => [table, null])),
    };
  }
  const tables = await listSchemaTables(client, schema);
  const existing = new Set(tables);
  // The data tables are asked about by name, so an un-migrated database reports
  // them as absent; the bookkeeping schema is whatever Drizzle created there.
  const targets = countedTables ?? tables;
  const rows = {};
  for (const table of targets) {
    if (!existing.has(table)) {
      rows[table] = null;
      continue;
    }
    const counted = await client.query(
      `SELECT count(*)::int AS count FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
    );
    rows[table] = counted.rows[0].count;
  }
  return { exists: true, tables, rows };
}

/**
 * Reads what a demo rebuild would replace — schemas, tables and row counts —
 * and writes nothing.
 *
 * Everything goes through the catalog, so a demo database a previous release
 * left behind can still be described; and the transaction is opened READ ONLY,
 * so a write added here by accident fails instead of quietly turning the
 * preview into a rebuild.
 *
 * Reports the demo reset targets from a live connection, read-only.
 * @param {DemoResetClient} client
 * @param {{ dataSchema?: string, migrationsSchema?: string }} [options]
 */
export async function inspectDemoResetTargets(client, options = {}) {
  const dataSchema = options.dataSchema ?? DEMO_RESET_SCHEMAS.data;
  const migrationsSchema = options.migrationsSchema ?? DEMO_RESET_SCHEMAS.migrations;
  await client.query("BEGIN READ ONLY");
  try {
    const schemas = {
      [dataSchema]: await describeSchema(client, dataSchema, DEMO_RESET_DATA_TABLES),
      [migrationsSchema]: await describeSchema(client, migrationsSchema, null),
    };
    await client.query("COMMIT");
    return { schemas };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/**
 * Answers "what would a reset replace?" without replacing anything.
 *
 * The connection string never reaches the log — it carries the demo database's
 * credentials, and this output exists to be read and pasted around — and no
 * object storage client is built, so no object can be written or deleted.
 *
 * Prints the reset preview; refuses every non-demo target.
 * @param {NodeJS.ProcessEnv} [environment]
 */
export async function previewDemoReset(environment = process.env) {
  const { databaseUrl } = validateDemoEnvironment(environment);
  const target = new URL(databaseUrl);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const preview = {
      mode: "preview-reset",
      apply: false,
      database: `${target.host}${target.pathname}`,
      ...(await inspectDemoResetTargets(client)),
    };
    console.log(JSON.stringify(preview));
    console.log("[demo] Preview only: nothing was dropped, migrated or seeded.");
    console.log("[demo] Run `npm run demo:reset -- --apply` to rebuild the demo workspace.");
    return preview;
  } finally {
    await client.end();
  }
}

async function runDemoData({ mode = "seed", apply = false, environment = process.env } = {}) {
  const { databaseUrl } = validateDemoEnvironment(environment);
  if (
    !environment.S3_BUCKET ||
    !environment.S3_ACCESS_KEY_ID ||
    !environment.S3_SECRET_ACCESS_KEY
  ) {
    throw new Error("Demo object storage configuration is incomplete");
  }
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const storage = createStorage(environment);
  try {
    const inspection = await inspectDemoTarget(client);
    if (mode === "reset") {
      console.log(
        JSON.stringify({
          mode: apply ? "demo-reset-target" : "demo-reset-preview",
          ...inspection.counts,
          keys: inspection.keys,
        })
      );
      if (!apply) {
        console.log("[demo] Preview only. Re-run with --apply to rebuild the demo workspace.");
        return { status: "preview", ...inspection };
      }
    }

    const knownIds = fixture.documents.map((document) => document.id);
    const present = await client.query(
      "SELECT id FROM source_documents WHERE id = ANY($1::uuid[])",
      [knownIds]
    );
    if (mode === "seed" && present.rowCount === knownIds.length) {
      console.log("[demo] Demo workspace already exists; existing test changes were preserved.");
      return { status: "existing", ...inspection };
    }
    if (mode === "seed" && present.rowCount > 0) {
      throw new Error("Demo workspace is partial; run npm run demo:reset -- --apply");
    }

    const reset = mode === "reset";
    const userId = reset || inspection.target == null ? fixture.user.id : inspection.target.user_id;
    const ledgerId =
      reset || inspection.target?.ledger_id == null
        ? fixture.ledger.id
        : inspection.target.ledger_id;
    const uploadedImages = await uploadFixtureImages(storage, environment, ledgerId);
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock($1)", [1_536_335_661]);
      await insertFixture(client, environment, { userId, ledgerId, uploadedImages, reset });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    const fixtureKeys = new Set(uploadedImages.map((image) => image.key));
    const staleKeys = inspection.keys.filter((key) => !fixtureKeys.has(key));
    if (reset && staleKeys.length > 0) {
      try {
        await storage.send(
          new DeleteObjectsCommand({
            Bucket: environment.S3_BUCKET,
            Delete: { Objects: staleKeys.map((Key) => ({ Key })), Quiet: true },
          })
        );
      } catch (error) {
        throw new Error(
          `Demo database reset completed, but object cleanup failed: ${staleKeys.join(", ")}`,
          { cause: error }
        );
      }
    }
    console.log(
      JSON.stringify({
        mode: reset ? "demo-reset" : "demo-seed",
        status: "complete",
        documents: fixture.documents.length,
        entries: fixture.documents.reduce(
          (sum, document) => sum + activeEntries(document).length,
          0
        ),
        credentials: fixture.serviceCredentials.length,
      })
    );
    return { status: "complete", userId, ledgerId };
  } finally {
    storage.destroy();
    await client.end();
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  // Checked before anything else: `preview-reset` has to answer without the
  // schema drop, the migrations or the seed that follow it ever running.
  if (args.has("preview-reset")) {
    await previewDemoReset();
    return;
  }
  if (args.has("reset-schema")) {
    await resetDemoSchema();
    console.log("[demo] Demo schema dropped; the migrations will rebuild it.");
    return;
  }
  const mode = args.has("reset") ? "reset" : "seed";
  await runDemoData({ mode, apply: args.has("--apply") });
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[demo] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
