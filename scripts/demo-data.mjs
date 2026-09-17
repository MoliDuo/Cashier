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
 * Demo tokens keep the app's real format so the seeded rows exercise the same
 * hashing and parsing path, but the prefix is applied here rather than stored in
 * the fixture: a literal `sk_live_` followed by 48 hex characters is
 * indistinguishable to GitHub push protection from a real Stripe-shaped key,
 * and it rejects the push. The composed token is only ever valid against the
 * local demo database, and it is printed at startup.
 *
 * @testOnly Composes a fixture credential's demo token.
 */
export function fixtureCredentialToken(credential) {
  return `${CREDENTIAL_TOKEN_PREFIX}${credential.tokenBody}`;
}

/**
 * Mirrors src/lib/security/service-credential-token.ts, which lives behind the
 * `@/` alias and cannot be imported from this script. The focused test pins
 * both implementations to the same digest so the rule cannot drift.
 *
 * @testOnly Hashes a fixture credential token the way the app does.
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

/** @testOnly Verifies that focused tests reject non-local demo targets. */
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
  if (fixture.partner.email !== "partner@cashier.local") {
    throw new Error("Demo fixture partner identity is invalid");
  }
  if ((environment.API_KEY_PEPPER ?? "").trim() === "") {
    throw new Error("API_KEY_PEPPER is required to seed demo service credentials");
  }
  return { databaseUrl: databaseUrl.toString(), storageUrl: storageUrl.toString() };
}

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

async function findDemoTarget(client) {
  const result = await client.query(
    `SELECT u.id AS user_id, l.id AS ledger_id
       FROM users u
       LEFT JOIN ledgers l ON l.user_id = u.id AND l.deleted_at IS NULL
      WHERE lower(u.email) = $1 AND u.deleted_at IS NULL
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
       (SELECT count(*)::int FROM ledgers WHERE user_id = $1) AS ledgers,
       (SELECT count(*)::int FROM source_documents WHERE ledger_id = $2) AS documents,
       (SELECT count(*)::int FROM ledger_entries WHERE ledger_id = $2) AS entries,
       (SELECT count(*)::int FROM stored_files WHERE ledger_id = $2) AS files`,
    [target.user_id, target.ledger_id]
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
    // Both members are removed, not just the workspace owner: the partner row
    // would otherwise survive with whatever migration 0047 backfilled, and the
    // profile the fixture describes — the nickname the switch is labelled from
    // — would only ever apply to a brand-new database.
    const emails = [fixture.user.email, fixture.partner.email];
    await client.query(
      `DELETE FROM revision_files
        WHERE ledger_id IN (
          SELECT l.id FROM ledgers l
          JOIN users u ON u.id = l.user_id
          WHERE lower(u.email) = ANY($1::text[])
        )`,
      [emails]
    );
    await client.query(
      `DELETE FROM upload_session_files
        WHERE ledger_id IN (
          SELECT l.id FROM ledgers l
          JOIN users u ON u.id = l.user_id
          WHERE lower(u.email) = ANY($1::text[])
        )`,
      [emails]
    );
    await client.query(
      `DELETE FROM ledgers WHERE user_id IN
        (SELECT id FROM users WHERE lower(email) = ANY($1::text[]))`,
      [emails]
    );
    await client.query("DELETE FROM users WHERE lower(email) = ANY($1::text[])", [emails]);
  }
  await client.query(
    `INSERT INTO users
      (id, email, name, nickname, gender, time_zone, email_verified, preferences, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '{"interfaceLanguage":"auto"}'::jsonb, $7, $7)
     ON CONFLICT (id) DO NOTHING`,
    [
      userId,
      fixture.user.email,
      fixture.user.name,
      fixture.user.nickname,
      fixture.user.gender,
      fixture.user.timeZone,
      now,
    ]
  );
  await ensurePartner(client, now);
  await client.query(
    `INSERT INTO ledgers
      (id, user_id, ai_language, preferred_currencies, main_currency, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     ON CONFLICT (id) DO NOTHING`,
    [
      ledgerId,
      userId,
      fixture.ledger.aiLanguage,
      fixture.ledger.preferredCurrencies,
      fixture.ledger.mainCurrency,
      now,
    ]
  );

  // The reset above deletes the ledger, so cascade already removed any earlier
  // credentials for this workspace; these rows are recreated with it.
  for (const credential of fixture.serviceCredentials) {
    const token = fixtureCredentialToken(credential);
    await client.query(
      `INSERT INTO service_credentials
        (id, ledger_id, attributed_user_id, name, token_hash, token_prefix, token_suffix, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        credential.id,
        ledgerId,
        credential.attributedTo === "partner" ? fixture.partner.id : userId,
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
      "SELECT id FROM entry_categories WHERE ledger_id = $1 AND name = $2 AND deleted_at IS NULL",
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
        (id, ledger_id, attributed_user_id, title, document_date, version, date_organization_suggestion, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $7)`,
      [
        document.id,
        ledgerId,
        document.attributedTo === "partner" ? fixture.partner.id : userId,
        document.title,
        documentDate,
        suggestion,
        createdAt,
      ]
    );
    if (document.retainedResult != null) {
      await client.query(
        `INSERT INTO source_document_revisions
          (id, ledger_id, source_document_id, revision_number, title, origin, input_text,
           input_document_date, input_date_reference, processing_status, submitted_at, finished_at,
           created_at)
         VALUES ($1, $2, $3, 1, $4, 'submission', $5, $6::text, $6::date, 'completed', $7, $7, $7)`,
        [
          document.retainedResult.revisionId,
          ledgerId,
          document.id,
          document.retainedResult.title,
          document.retainedResult.inputText,
          documentDate,
          createdAt,
        ]
      );
    }
    await client.query(
      `INSERT INTO source_document_revisions
        (id, ledger_id, source_document_id, revision_number, title, origin, input_text,
         input_document_date, input_date_reference, processing_status, failure_kind, failure_code,
         failure_message, submitted_at, finished_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text, $8::date, $9, $10, $11, $12, $13, $13, $13)`,
      [
        document.revisionId,
        ledgerId,
        document.id,
        document.retainedResult == null ? 1 : 2,
        document.title,
        document.type === "manual" ? "manual_entry" : "submission",
        document.inputText,
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
          (id, ledger_id, storage_provider, storage_key, content_type, byte_size,
           original_filename, checksum, created_at, finalized_at)
         VALUES ($1, $2, 's3', $3, 'image/jpeg', $4, $5, $6, $7, $7)`,
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
        `INSERT INTO revision_files (ledger_id, revision_id, stored_file_id, position, created_at)
         VALUES ($1, $2, $3, 0, $4)`,
        [ledgerId, document.revisionId, image.fileId, createdAt]
      );
    }
    const entryRevisionId = document.retainedResult?.revisionId ?? document.revisionId;
    for (const [position, entry] of activeEntries(document).entries()) {
      const categoryId = entry.category == null ? null : (categoryIds.get(entry.category) ?? null);
      if (entry.category != null && categoryId == null) {
        throw new Error(`Unknown demo category: ${entry.category}`);
      }
      await client.query(
        `INSERT INTO ledger_entries
          (id, ledger_id, category_id, source_document_id, source_document_revision_id,
           position, amount, currency, item_name, description, converted_amount, exchange_rate,
           created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
        [
          entry.id,
          ledgerId,
          categoryId,
          document.id,
          entryRevisionId,
          position,
          entry.amount,
          entry.currency,
          entry.itemName,
          entry.description ?? null,
          entry.convertedAmount,
          entry.exchangeRate,
          createdAt,
        ]
      );
    }
    await client.query(
      `UPDATE source_documents
          SET active_revision_id = $1, latest_submission_revision_id = $2
        WHERE id = $3`,
      [
        document.status === "completed"
          ? document.revisionId
          : (document.retainedResult?.revisionId ?? null),
        document.revisionId,
        document.id,
      ]
    );
    if (document.status === "failed") {
      const invalid = document.failureKind === "invalid_input";
      const retryClassification = invalid
        ? "invalid"
        : document.failureCode === "request_bound_retry_exhausted"
          ? "permanent"
          : "retryable";
      await client.query(
        `INSERT INTO processing_attempts
          (ledger_id, revision_id, attempt_number, status, retry_classification,
           diagnostic_code, completed_at, created_at)
         VALUES ($1, $2, 1, $3, $4, $5, $6, $6)`,
        [
          ledgerId,
          document.revisionId,
          invalid ? "invalid" : "failed",
          retryClassification,
          document.failureCode,
          createdAt,
        ]
      );
    }
  }
}

async function ensurePartner(client, now = new Date()) {
  await client.query(
    `INSERT INTO users
      (id, email, name, nickname, gender, time_zone, email_verified, preferences, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '{"interfaceLanguage":"auto"}'::jsonb, $7, $7)
     ON CONFLICT (id) DO NOTHING`,
    [
      fixture.partner.id,
      fixture.partner.email,
      fixture.partner.name,
      fixture.partner.nickname,
      fixture.partner.gender,
      fixture.partner.timeZone,
      now,
    ]
  );
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
      await ensurePartner(client);
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
  const mode = args.has("reset") ? "reset" : "seed";
  await runDemoData({ mode, apply: args.has("--apply") });
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[demo] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
