import pg, { type Client, type PoolClient } from "pg";
import { z } from "zod";
import Decimal from "decimal.js";
import { pathToFileURL } from "node:url";

const MoneyDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

const { Pool } = pg;
type DatabaseClient = Client | PoolClient;
type CoupleIds = { owner: string; partner: string; ledger: string };

function readConfig() {
  return z
    .object({
      owner: z.string().uuid(),
      partner: z.string().uuid(),
      ledger: z.string().uuid(),
      url: z.string().min(1),
    })
    .refine((value) => value.owner !== value.partner)
    .parse({
      owner: process.env.COUPLE_OWNER_USER_ID,
      partner: process.env.COUPLE_PARTNER_USER_ID,
      ledger: process.env.COUPLE_LEDGER_ID,
      url: process.env.DATABASE_URL,
    });
}

// Unknown ledger-scoped tables stop the migration until their relationships are reviewed.
const movable = [
  "entry_categories",
  "source_documents",
  "source_document_revisions",
  "stored_files",
  "revision_files",
  "processing_attempts",
  "processing_outbox",
  "upload_sessions",
  "upload_session_files",
  "category_reclassification_jobs",
  "category_assignment_selection_chunks",
  "category_reclassification_job_documents",
  "category_reclassification_job_entries",
  "ledger_entries",
  "service_credentials",
  "exchange_rate_recalculation_jobs",
] as const;
const special = ["ledger_sync_state", "ledger_change_batches"] as const;
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
function convert(
  amount: string,
  source: string,
  target: string,
  rate?: { base: string; rates: Record<string, number> }
) {
  const decimals = ["JPY", "KRW", "VND", "CLP", "COP", "ISK"].includes(target)
    ? 0
    : ["BHD", "JOD", "KWD", "OMR", "TND"].includes(target)
      ? 3
      : 2;
  if (source === target)
    return {
      convertedAmount: new MoneyDecimal(amount).toDecimalPlaces(decimals).toFixed(),
      exchangeRate: "1",
    };
  if (rate == null) throw new Error("Missing stored exchange rate for migrated entry");
  const from = source === rate.base ? 1 : rate.rates[source];
  const to = target === rate.base ? 1 : rate.rates[target];
  if (
    from == null ||
    to == null ||
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from <= 0 ||
    to <= 0
  )
    throw new Error("Missing valid stored exchange rate for migrated entry");
  const ratio = new MoneyDecimal(to).div(from);
  return {
    convertedAmount: new MoneyDecimal(amount).mul(ratio).toDecimalPlaces(decimals).toFixed(),
    exchangeRate: ratio.toDecimalPlaces(12).toFixed(),
  };
}
type Ledger = { id: string; user_id: string; main_currency: string };
type Category = {
  id: string;
  ledger_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
};

const preservedTables = [
  "source_documents",
  "source_document_revisions",
  "ledger_entries",
  "stored_files",
  "revision_files",
  "service_credentials",
] as const;

async function integrityFingerprints(
  client: DatabaseClient,
  ledgerIds: string[],
  sameCurrency: boolean
) {
  const fingerprints: Record<string, string> = {};
  for (const table of preservedTables) {
    const excluded = ["ledger_id"];
    if (table === "source_documents" || table === "service_credentials")
      excluded.push("attributed_user_id");
    if (table === "ledger_entries") {
      excluded.push("category_id");
      if (!sameCurrency) excluded.push("converted_amount", "exchange_rate");
    }
    const row = await client.query<{ fingerprint: string }>(
      `SELECT md5(coalesce(string_agg(
         (to_jsonb(t) - $2::text[])::text, E'\\n' ORDER BY id
       ), '')) AS fingerprint
       FROM ${quote(table)} t WHERE ledger_id = ANY($1::uuid[])`,
      [ledgerIds, excluded]
    );
    fingerprints[table] = row.rows[0]!.fingerprint;
  }
  return fingerprints;
}

async function inspect(client: DatabaseClient, lock: boolean, config: CoupleIds) {
  const schema = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema()
       AND table_name = 'users' AND column_name = 'registration_completed_at'`
  );
  const attribution = await client.query<{ table_name: string; is_nullable: string }>(
    `SELECT table_name, is_nullable FROM information_schema.columns WHERE table_schema = current_schema()
       AND table_name IN ('source_documents', 'service_credentials') AND column_name = 'attributed_user_id'`
  );
  if (
    attribution.rowCount !== 2 ||
    attribution.rows.some((row) => row.is_nullable !== (schema.rowCount ? "YES" : "NO"))
  )
    throw new Error("Unknown couple attribution schema");
  const users = await client.query(
    `SELECT id FROM users WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
     ${schema.rowCount ? "AND registration_completed_at IS NOT NULL" : ""}`,
    [[config.owner, config.partner]]
  );
  if (users.rowCount !== 2) throw new Error("Both existing accounts must be active");
  const ledgers = await client.query<Ledger>(
    `SELECT id, user_id, main_currency FROM ledgers WHERE user_id = ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY user_id ${lock ? "FOR UPDATE" : ""}`,
    [[config.owner, config.partner]]
  );
  if (ledgers.rowCount !== 2) throw new Error("Expected exactly one active ledger per account");
  const owner = ledgers.rows.find((row) => row.user_id === config.owner)!;
  const partner = ledgers.rows.find((row) => row.user_id === config.partner)!;
  if (owner.id !== config.ledger)
    throw new Error("Configured shared ledger differs from the owner ledger");
  const sameCurrency = owner.main_currency === partner.main_currency;
  const tables = await client.query<{ table_name: string }>(
    "SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'ledger_id' AND table_name <> 'ledgers'"
  );
  const actual = new Set(tables.rows.map((row) => row.table_name));
  const known = new Set<string>([...movable, ...special]);
  if (
    [...actual].some((table) => !known.has(table)) ||
    [...known].some((table) => !actual.has(table))
  )
    throw new Error("Ledger-associated table set differs from reviewed schema");
  const counts: Record<string, number> = {};
  const ownerCounts: Record<string, number> = {};
  for (const table of [...movable, ...special]) {
    const row = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${quote(table)} WHERE ledger_id = $1`,
      [partner.id]
    );
    counts[table] = Number(row.rows[0]!.count);
    const ownerRow = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${quote(table)} WHERE ledger_id = $1`,
      [owner.id]
    );
    ownerCounts[table] = Number(ownerRow.rows[0]!.count);
  }
  const categories = await client.query<Category>(
    "SELECT id, ledger_id, name, description, icon, sort_order FROM entry_categories WHERE ledger_id = ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY id",
    [[owner.id, partner.id]]
  );
  const ownerNames = new Set(
    categories.rows.filter((row) => row.ledger_id === owner.id).map((row) => row.name)
  );
  // Report each non-terminal row group so a blocked merge names what to settle
  // instead of only stating that *something* is active.
  const pending = await client.query<{ source: string; status: string; count: string }>(
    `SELECT source, status, count FROM (
      SELECT 'processing_attempts' AS source, status::text AS status, count(*) AS count
        FROM processing_attempts WHERE ledger_id = ANY($1::uuid[]) AND status IN ('queued','processing')
        GROUP BY status
      UNION ALL
      SELECT 'processing_outbox', status::text, count(*)
        FROM processing_outbox WHERE ledger_id = ANY($1::uuid[]) AND status IN ('pending','claimed')
        GROUP BY status
      UNION ALL
      SELECT 'category_reclassification_jobs', status::text, count(*)
        FROM category_reclassification_jobs WHERE ledger_id = ANY($1::uuid[]) AND status IN ('preparing','pending','running')
        GROUP BY status
      UNION ALL
      SELECT 'upload_sessions', status::text, count(*)
        FROM upload_sessions WHERE ledger_id = ANY($1::uuid[]) AND status IN ('open','finalizing')
        GROUP BY status
      UNION ALL
      SELECT 'exchange_rate_recalculation_jobs', status::text, count(*)
        FROM exchange_rate_recalculation_jobs WHERE ledger_id = ANY($1::uuid[]) AND status IN ('pending','claimed')
        GROUP BY status
    ) pending WHERE count > 0 ORDER BY source, status`,
    [[owner.id, partner.id]]
  );
  const pendingWork = pending.rows.map((row) => ({
    source: row.source,
    status: row.status,
    count: Number(row.count),
  }));
  const fingerprints = await integrityFingerprints(client, [owner.id, partner.id], sameCurrency);
  const originalAttributions = await client.query<{ ledger_id: string; count: string }>(
    `SELECT d.ledger_id, count(*)::text AS count
     FROM source_documents d JOIN ledgers l ON l.id = d.ledger_id
     WHERE d.ledger_id = ANY($1::uuid[]) AND d.attributed_user_id IS NOT NULL
       AND d.attributed_user_id <> l.user_id
     GROUP BY d.ledger_id`,
    [[owner.id, partner.id]]
  );
  const credentialAttributions = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM service_credentials c
     JOIN ledgers l ON l.id = c.ledger_id
     WHERE c.ledger_id = ANY($1::uuid[]) AND c.attributed_user_id IS NOT NULL
       AND c.attributed_user_id <> l.user_id`,
    [[owner.id, partner.id]]
  );
  return {
    owner,
    partner,
    counts,
    ownerCounts,
    categories: categories.rows,
    collisionCount: categories.rows.filter(
      (row) => row.ledger_id === partner.id && ownerNames.has(row.name)
    ).length,
    pendingJobs: pendingWork.reduce((sum, work) => sum + work.count, 0),
    pendingWork,
    fingerprints,
    attributionAnomalies:
      originalAttributions.rows.reduce((sum, row) => sum + Number(row.count), 0) +
      Number(credentialAttributions.rows[0]!.count),
  };
}

async function merge(client: DatabaseClient, state: Awaited<ReturnType<typeof inspect>>) {
  const { owner, partner } = state;
  if (state.pendingJobs)
    throw new Error(
      `Active or queued work exists; pause workers and settle jobs: ${state.pendingWork
        .map((work) => `${work.source} ${work.status} (${work.count})`)
        .join(", ")}`
    );
  if (state.attributionAnomalies)
    throw new Error("Existing attribution differs from the original ledger owner");
  // Composite relationships form cycles (documents and revisions). Transactional
  // DDL allows us to defer their foreign keys and restore their original mode.
  const keys = await client.query<{
    table_name: string;
    constraint_name: string;
  }>(`SELECT rel.relname AS table_name, con.conname AS constraint_name
    FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE con.contype = 'f' AND con.connamespace = current_schema()::regnamespace AND NOT con.condeferrable`);
  for (const key of keys.rows)
    await client.query(
      `ALTER TABLE ${quote(key.table_name)} ALTER CONSTRAINT ${quote(key.constraint_name)} DEFERRABLE INITIALLY DEFERRED`
    );
  await client.query("SET CONSTRAINTS ALL DEFERRED");
  const changeLogTables = [
    "source_documents",
    "source_document_revisions",
    "ledger_entries",
    "entry_categories",
  ];
  for (const table of changeLogTables)
    await client.query(
      `ALTER TABLE ${quote(table)} DISABLE TRIGGER ${quote(`trg_${table}_change_log`)}`
    );
  for (const ledger of [owner, partner]) {
    await client.query("UPDATE source_documents SET attributed_user_id = $1 WHERE ledger_id = $2", [
      ledger.user_id,
      ledger.id,
    ]);
    await client.query(
      "UPDATE service_credentials SET attributed_user_id = $1 WHERE ledger_id = $2",
      [ledger.user_id, ledger.id]
    );
  }
  const existingNames = new Set(state.categories.map((row) => row.name));
  for (const category of state.categories.filter((row) => row.ledger_id === partner.id)) {
    const match = state.categories.find(
      (row) => row.ledger_id === owner.id && row.name === category.name
    );
    if (match == null) continue;
    if (
      match.description === category.description &&
      match.icon === category.icon &&
      match.sort_order === category.sort_order
    ) {
      await client.query(
        "UPDATE ledger_entries SET category_id = $1 WHERE ledger_id = $2 AND category_id = $3",
        [match.id, partner.id, category.id]
      );
      await client.query(
        "UPDATE category_reclassification_jobs SET direct_category_id = CASE WHEN direct_category_id = $3 THEN $1 ELSE direct_category_id END, candidate_category_ids = array_replace(candidate_category_ids, $3::uuid, $1::uuid) WHERE ledger_id = $2",
        [match.id, partner.id, category.id]
      );
      await client.query(
        "UPDATE category_reclassification_job_entries SET original_category_id = CASE WHEN original_category_id = $3 THEN $1 ELSE original_category_id END, target_category_id = CASE WHEN target_category_id = $3 THEN $1 ELSE target_category_id END WHERE ledger_id = $2",
        [match.id, partner.id, category.id]
      );
      await client.query("UPDATE entry_categories SET deleted_at = now() WHERE id = $1", [
        category.id,
      ]);
    } else {
      let name = `${category.name} (migrated ${category.id.slice(0, 8)})`;
      if (existingNames.has(name)) name = `${category.name} (migrated ${category.id})`;
      await client.query("UPDATE entry_categories SET name = $1 WHERE id = $2", [
        name,
        category.id,
      ]);
      existingNames.add(name);
    }
  }
  if (owner.main_currency !== partner.main_currency) {
    const entries = await client.query<{
      id: string;
      amount: string;
      currency: string;
      document_date: string | null;
    }>(
      "SELECT e.id, e.amount::text AS amount, e.currency, d.document_date::text FROM ledger_entries e LEFT JOIN source_documents d ON d.id = e.source_document_id AND d.ledger_id = e.ledger_id WHERE e.ledger_id = $1",
      [partner.id]
    );
    const unlinked = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ledger_entries e
       LEFT JOIN source_documents d ON d.id = e.source_document_id AND d.ledger_id = e.ledger_id
       WHERE e.ledger_id = $1 AND d.id IS NULL`,
      [partner.id]
    );
    if (Number(unlinked.rows[0]!.count) > 0)
      throw new Error("Entries without a source document need manual review before conversion");
    const rates = await client.query<{ date: string; base: string; rates: Record<string, number> }>(
      "SELECT date::text, base, rates FROM currency_rates ORDER BY date DESC"
    );
    const byDate = new Map(rates.rows.map((rate) => [rate.date, rate]));
    for (const entry of entries.rows) {
      const rate = entry.document_date == null ? rates.rows[0] : byDate.get(entry.document_date);
      const conversion = convert(entry.amount, entry.currency, owner.main_currency, rate);
      await client.query(
        "UPDATE ledger_entries SET converted_amount = $1, exchange_rate = $2 WHERE id = $3",
        [conversion.convertedAmount, conversion.exchangeRate, entry.id]
      );
    }
  }
  const sync = await client.query<{ ledger_id: string; version: string }>(
    "SELECT ledger_id, version::text FROM ledger_sync_state WHERE ledger_id = ANY($1::uuid[])",
    [[owner.id, partner.id]]
  );
  const offset = BigInt(sync.rows.find((row) => row.ledger_id === owner.id)?.version ?? "0");
  const oldBatches = await client.query<{ version: string }>(
    "SELECT version::text FROM ledger_change_batches WHERE ledger_id = $1 ORDER BY version DESC",
    [partner.id]
  );
  if (oldBatches.rows.length !== state.counts.ledger_change_batches)
    throw new Error("Change history count changed during migration");
  for (const batch of oldBatches.rows) {
    await client.query(
      "UPDATE ledger_change_batches SET ledger_id = $1, version = $2, transaction_id = -$2::bigint WHERE ledger_id = $3 AND version = $4",
      [owner.id, (offset + BigInt(batch.version)).toString(), partner.id, batch.version]
    );
  }
  await client.query("DELETE FROM ledger_sync_state WHERE ledger_id = $1", [partner.id]);
  for (const table of movable) {
    const moved = await client.query(
      `UPDATE ${quote(table)} SET ledger_id = $1 WHERE ledger_id = $2`,
      [owner.id, partner.id]
    );
    if (moved.rowCount !== state.counts[table])
      throw new Error(`Record count changed during migration: ${table}`);
  }
  const partnerVersion = BigInt(
    sync.rows.find((row) => row.ledger_id === partner.id)?.version ?? "0"
  );
  const nextVersion = offset + partnerVersion + BigInt(1);
  await client.query(
    `INSERT INTO ledger_sync_state (ledger_id, version, updated_at) VALUES ($1, $2, now())
    ON CONFLICT (ledger_id) DO UPDATE SET version = $2, updated_at = now()`,
    [owner.id, nextVersion.toString()]
  );
  await client.query(
    `INSERT INTO ledger_change_batches (ledger_id, version, transaction_id, categories_changed, stats_changed, reset_required)
     VALUES ($1, $2, txid_current(), true, true, true)`,
    [owner.id, nextVersion.toString()]
  );
  await client.query("UPDATE ledgers SET deleted_at = now() WHERE id = $1", [partner.id]);
  await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  for (const table of changeLogTables)
    await client.query(
      `ALTER TABLE ${quote(table)} ENABLE TRIGGER ${quote(`trg_${table}_change_log`)}`
    );
  for (const key of keys.rows)
    await client.query(
      `ALTER TABLE ${quote(key.table_name)} ALTER CONSTRAINT ${quote(key.constraint_name)} NOT DEFERRABLE`
    );
  for (const table of [...movable, ...special]) {
    const remaining = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${quote(table)} WHERE ledger_id = $1`,
      [partner.id]
    );
    if (Number(remaining.rows[0]!.count) !== 0)
      throw new Error(`Unmigrated ledger references: ${table}`);
    if (table !== "ledger_sync_state") {
      const merged = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${quote(table)} WHERE ledger_id = $1`,
        [owner.id]
      );
      const expected =
        state.ownerCounts[table]! +
        state.counts[table]! +
        (table === "ledger_change_batches" ? 1 : 0);
      if (Number(merged.rows[0]!.count) !== expected)
        throw new Error(`Merged record count mismatch: ${table}`);
    }
  }
  const fingerprints = await integrityFingerprints(
    client,
    [owner.id],
    owner.main_currency === partner.main_currency
  );
  for (const table of preservedTables)
    if (fingerprints[table] !== state.fingerprints[table])
      throw new Error(`Migrated record contents changed: ${table}`);
  for (const [userId, expected] of [
    [owner.user_id, state.ownerCounts.source_documents],
    [partner.user_id, state.counts.source_documents],
  ] as const) {
    const documents = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM source_documents WHERE ledger_id = $1 AND attributed_user_id = $2",
      [owner.id, userId]
    );
    const credentials = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM service_credentials WHERE ledger_id = $1 AND attributed_user_id = $2",
      [owner.id, userId]
    );
    const expectedCredentials =
      userId === owner.user_id
        ? state.ownerCounts.service_credentials
        : state.counts.service_credentials;
    if (
      Number(documents.rows[0]!.count) !== expected ||
      Number(credentials.rows[0]!.count) !== expectedCredentials
    )
      throw new Error("Migrated ownership does not match original ledger ownership");
  }
}

function summarize(state: Awaited<ReturnType<typeof inspect>>) {
  return {
    sharedLedgerId: state.owner.id,
    mainCurrencyDiffers: state.owner.main_currency !== state.partner.main_currency,
    categoryConflictCount: state.collisionCount,
    pendingJobs: state.pendingJobs,
    pendingWork: state.pendingWork,
    attributionAnomalies: state.attributionAnomalies,
    ownerRecords: state.ownerCounts,
    partnerRecords: state.counts,
  };
}

/** Applies the reviewed ledger merge on an existing connection. The caller owns the transaction. */
export async function mergeCoupleLedger(client: DatabaseClient, config: CoupleIds) {
  const state = await inspect(client, true, config);
  await merge(client, state);
  return summarize(state);
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (process.argv.some((arg) => arg.startsWith("--") && arg !== "--apply"))
    throw new Error("Unknown option");
  const config = readConfig();
  const pool = new Pool({ connectionString: config.url, max: 1 });
  try {
    const client = await pool.connect();
    try {
      await client.query(apply ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      try {
        if (apply) {
          await client.query("SET LOCAL lock_timeout = '10s'");
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended('cashier-couple-merge', 0))"
          );
        }
        const summary = apply
          ? await mergeCoupleLedger(client, config)
          : summarize(await inspect(client, false, config));
        await client.query(apply ? "COMMIT" : "ROLLBACK");
        console.log(JSON.stringify({ ...summary, mode: apply ? "apply" : "preview" }, null, 2));
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
